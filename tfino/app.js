const VOCAB = ["<BOS>", "the", "sun", "moon", "rises", "sets", "east", "west", ".", "glows"];
const TOKEN = Object.fromEntries(VOCAB.map((token, index) => [token, index]));
const DIM = 8;
const CONTEXT = 4;
// Compiled form of kernels.wat. Keeping the 274-byte module inline makes the
// static PWA portable even on hosts that cannot attach a binary asset.
const WASM_BASE64 = "AGFzbQEAAAABFQNgA39/fwF9YAR/f31/AGACf38BfwMEAwABAgUDAQACBx8EBm1lbW9yeQIAA2RvdAAAA3NnZAABBmFyZ21heAACCsQBAzoCAX8BfQJAA0AgAyACTw0BIAQgACADQQRsaioCACABIANBBGxqKgIAlJIhBCADQQFqIQMMAAsLIAQLOwECfwJAA0AgBCADTw0BIAAgBEEEbGoiBSAFKgIAIAEgBEEEbGoqAgAgApSTOAIAIARBAWohBAwACwsLSwICfwF9IAAqAgAhBEEBIQICQANAIAIgAU8NASAAIAJBBGxqKgIAIAReBEAgACACQQRsaioCACEEIAIhAwsgAkEBaiECDAALCyADCw==";

const CORPORA = {
  balanced: [
    "the sun rises east .", "the sun sets west .", "the moon rises east .",
    "the moon sets west .", "the sun glows .", "the moon glows ."
  ],
  east: [
    "the sun rises east .", "the sun rises east .", "the moon rises east .",
    "the sun glows .", "the moon glows .", "the sun sets west ."
  ],
  west: [
    "the sun sets west .", "the sun sets west .", "the moon sets west .",
    "the sun glows .", "the moon glows .", "the sun rises east ."
  ]
};

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function seeded(index) {
  const x = Math.sin(index * 12.9898 + 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

const EMBEDDINGS = new Float32Array(VOCAB.length * DIM);
for (let token = 0; token < VOCAB.length; token++) {
  for (let d = 0; d < DIM; d++) EMBEDDINGS[token * DIM + d] = seeded(token * DIM + d) * 0.72;
}

class WasmKernels {
  constructor() {
    this.ready = false;
    this.exports = null;
  }

  async init() {
    const binary = atob(WASM_BASE64);
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    const { instance } = await WebAssembly.instantiate(bytes);
    this.exports = instance.exports;
    this.ready = true;
  }

  dot(a, b) {
    if (!this.ready) return a.reduce((sum, value, i) => sum + value * b[i], 0);
    const floats = new Float32Array(this.exports.memory.buffer);
    floats.set(a, 0);
    floats.set(b, a.length);
    return this.exports.dot(0, a.length * 4, a.length);
  }

  sgd(weights, gradient, rate) {
    if (!this.ready) {
      for (let i = 0; i < weights.length; i++) weights[i] -= rate * gradient[i];
      return;
    }
    const floats = new Float32Array(this.exports.memory.buffer);
    const gradientOffset = weights.length;
    floats.set(weights, 0);
    floats.set(gradient, gradientOffset);
    this.exports.sgd(0, gradientOffset * 4, rate, weights.length);
    weights.set(floats.slice(0, weights.length));
  }
}

class WebGPUBackend {
  constructor() {
    this.ready = false;
    this.device = null;
    this.pipeline = null;
  }

  async init() {
    if (!navigator.gpu) throw new Error("WebGPU unavailable");
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("No GPU adapter");
    this.device = await adapter.requestDevice();
    const shader = this.device.createShaderModule({ code: `
      struct Meta { rows: u32, cols: u32 }
      @group(0) @binding(0) var<storage, read> weights: array<f32>;
      @group(0) @binding(1) var<storage, read> hidden: array<f32>;
      @group(0) @binding(2) var<storage, read_write> logits: array<f32>;
      @group(0) @binding(3) var<uniform> meta: Meta;

      @compute @workgroup_size(64)
      fn main(@builtin(global_invocation_id) id: vec3<u32>) {
        let row = id.x;
        if (row >= meta.rows) { return; }
        var sum = 0.0;
        for (var col = 0u; col < meta.cols; col = col + 1u) {
          sum = sum + weights[row * meta.cols + col] * hidden[col];
        }
        logits[row] = sum;
      }
    `});
    this.pipeline = this.device.createComputePipeline({
      layout: "auto",
      compute: { module: shader, entryPoint: "main" }
    });
    this.ready = true;
  }

  buffer(data, usage) {
    const buffer = this.device.createBuffer({ size: Math.max(16, Math.ceil(data.byteLength / 4) * 4), usage, mappedAtCreation: true });
    new data.constructor(buffer.getMappedRange()).set(data);
    buffer.unmap();
    return buffer;
  }

  async logits(weights, hidden) {
    const GPU = globalThis.GPUBufferUsage;
    const weightBuffer = this.buffer(weights, GPU.STORAGE);
    const hiddenBuffer = this.buffer(hidden, GPU.STORAGE);
    const outputBuffer = this.device.createBuffer({ size: VOCAB.length * 4, usage: GPU.STORAGE | GPU.COPY_SRC });
    const metaBuffer = this.buffer(new Uint32Array([VOCAB.length, DIM, 0, 0]), GPU.UNIFORM);
    const readBuffer = this.device.createBuffer({ size: VOCAB.length * 4, usage: GPU.COPY_DST | GPU.MAP_READ });
    const bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: weightBuffer } },
        { binding: 1, resource: { buffer: hiddenBuffer } },
        { binding: 2, resource: { buffer: outputBuffer } },
        { binding: 3, resource: { buffer: metaBuffer } }
      ]
    });
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(VOCAB.length / 64));
    pass.end();
    encoder.copyBufferToBuffer(outputBuffer, 0, readBuffer, 0, VOCAB.length * 4);
    this.device.queue.submit([encoder.finish()]);
    await readBuffer.mapAsync(GPUMapMode.READ);
    const result = new Float32Array(readBuffer.getMappedRange().slice(0));
    readBuffer.unmap();
    [weightBuffer, hiddenBuffer, outputBuffer, metaBuffer, readBuffer].forEach(buffer => buffer.destroy());
    return result;
  }
}

class TinyTransformer {
  constructor(wasm, gpu) {
    this.wasm = wasm;
    this.gpu = gpu;
    this.weights = new Float32Array(VOCAB.length * DIM);
    this.examplesSeen = 0;
    this.preferenceSteps = 0;
    this.lastLoss = null;
    this.reset();
  }

  reset() {
    for (let i = 0; i < this.weights.length; i++) this.weights[i] = seeded(1000 + i) * 0.12;
    this.examplesSeen = 0;
    this.preferenceSteps = 0;
    this.lastLoss = null;
  }

  tokenize(text) {
    return text.toLowerCase().replace(/\./g, " . ").trim().split(/\s+/)
      .map(token => TOKEN[token]).filter(token => token !== undefined);
  }

  embedding(token) {
    return EMBEDDINGS.slice(token * DIM, (token + 1) * DIM);
  }

  // One frozen causal self-attention head. The last token is the query; all
  // preceding tokens are keys/values. This is compact, but structurally real.
  hidden(sequence) {
    const context = sequence.slice(-CONTEXT);
    const query = this.embedding(context.at(-1) ?? TOKEN["<BOS>"]);
    const scores = context.map((token, position) =>
      this.wasm.dot(query, this.embedding(token)) / Math.sqrt(DIM) + position * 0.035
    );
    const max = Math.max(...scores);
    const exp = scores.map(score => Math.exp(score - max));
    const total = exp.reduce((sum, value) => sum + value, 0);
    const hidden = new Float32Array(DIM);
    context.forEach((token, position) => {
      const value = this.embedding(token);
      const attention = exp[position] / total;
      for (let d = 0; d < DIM; d++) hidden[d] += attention * value[d];
    });
    for (let d = 0; d < DIM; d++) hidden[d] = Math.tanh(hidden[d] + query[d] * 0.35);
    return hidden;
  }

  cpuLogits(hidden) {
    const result = new Float32Array(VOCAB.length);
    for (let token = 0; token < VOCAB.length; token++) {
      result[token] = this.wasm.dot(this.weights.subarray(token * DIM, (token + 1) * DIM), hidden);
    }
    return result;
  }

  async logits(sequence, preferGPU = false) {
    const hidden = this.hidden(sequence);
    if (preferGPU && this.gpu.ready) return this.gpu.logits(this.weights, hidden);
    return this.cpuLogits(hidden);
  }

  probabilities(logits, temperature = 1) {
    const scaled = [...logits].map((value, index) => index === TOKEN["<BOS>"] ? -1e9 : value / Math.max(.1, temperature));
    const max = Math.max(...scaled);
    const exp = scaled.map(value => Math.exp(value - max));
    const total = exp.reduce((sum, value) => sum + value, 0);
    return exp.map(value => value / total);
  }

  async train(lines, epochs, onEpoch) {
    const examples = [];
    lines.forEach(line => {
      const tokens = [TOKEN["<BOS>"], ...this.tokenize(line)];
      for (let i = 1; i < tokens.length; i++) examples.push({ input: tokens.slice(Math.max(0, i - CONTEXT), i), target: tokens[i] });
    });
    const losses = [];
    for (let epoch = 0; epoch < epochs; epoch++) {
      let epochLoss = 0;
      for (const example of examples) {
        const hidden = this.hidden(example.input);
        const logits = this.cpuLogits(hidden);
        const probs = this.probabilities(logits);
        epochLoss += -Math.log(Math.max(1e-7, probs[example.target]));
        const gradient = new Float32Array(this.weights.length);
        for (let token = 0; token < VOCAB.length; token++) {
          const error = probs[token] - (token === example.target ? 1 : 0);
          for (let d = 0; d < DIM; d++) gradient[token * DIM + d] = error * hidden[d];
        }
        this.wasm.sgd(this.weights, gradient, 0.18);
        this.examplesSeen++;
      }
      const mean = epochLoss / examples.length;
      losses.push(mean);
      this.lastLoss = mean;
      onEpoch?.(epoch, mean);
      if (epoch % 4 === 0) await sleep(0);
    }
    return losses;
  }

  preference(prompt, preferred, rejected) {
    const hidden = this.hidden(this.tokenize(prompt));
    const logits = this.cpuLogits(hidden);
    const preferredId = TOKEN[preferred];
    const rejectedId = TOKEN[rejected];
    const margin = logits[preferredId] - logits[rejectedId];
    const derivative = -1 / (1 + Math.exp(margin));
    const gradient = new Float32Array(this.weights.length);
    for (let d = 0; d < DIM; d++) {
      gradient[preferredId * DIM + d] = derivative * hidden[d];
      gradient[rejectedId * DIM + d] = -derivative * hidden[d];
    }
    this.wasm.sgd(this.weights, gradient, 0.8);
    this.preferenceSteps++;
  }
}

const wasm = new WasmKernels();
const gpu = new WebGPUBackend();
const model = new TinyTransformer(wasm, gpu);
let deferredInstall = null;

function setStage(stage) {
  $$(".stage-panel").forEach(panel => {
    const active = panel.id === stage;
    panel.hidden = !active;
    panel.classList.toggle("active", active);
  });
  $$(".stage-tab").forEach(tab => {
    const active = tab.dataset.stage === stage;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-pressed", active);
  });
  $("#" + stage).scrollIntoView({ behavior: "smooth", block: "start" });
  if (stage === "posttrain") refreshPreference();
  if (stage === "infer") previewInference();
}

function updateMetrics() {
  $("#metricLoss").textContent = model.lastLoss === null ? "—" : model.lastLoss.toFixed(3);
  $("#metricExamples").textContent = model.examplesSeen.toLocaleString();
  $("#metricPrefs").textContent = model.preferenceSteps;
  $("#metricBackend").textContent = gpu.ready ? "WebGPU" : "Wasm fallback";
  $("#weightPulse").textContent = `${model.weights.length} weights`;
  const core = $(".model-core");
  core.classList.remove("pulse");
  requestAnimationFrame(() => core.classList.add("pulse"));
}

function renderCorpus() {
  const lines = CORPORA[$("#corpusSelect").value];
  $("#corpusPreview").innerHTML = lines.map((line, i) => `<div>${String(i + 1).padStart(2, "0")} · ${line}</div>`).join("");
}

function drawLoss(values) {
  const canvas = $("#lossChart");
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || 620;
  const height = canvas.clientHeight || 260;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const ctx = canvas.getContext("2d");
  ctx.scale(ratio, ratio);
  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = "rgba(17,18,15,.12)";
  ctx.lineWidth = 1;
  for (let y = 18; y < height; y += (height - 36) / 4) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
  }
  if (values.length < 2) {
    ctx.fillStyle = "#8f9087"; ctx.font = "11px DM Mono, monospace";
    ctx.fillText("Run pretraining to draw the learning curve", 16, height / 2);
    return;
  }
  const min = Math.min(...values) * .9;
  const max = Math.max(...values) * 1.05;
  ctx.beginPath();
  values.forEach((value, i) => {
    const x = i / (values.length - 1) * width;
    const y = 18 + (1 - (value - min) / Math.max(.001, max - min)) * (height - 36);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.strokeStyle = "#11120f"; ctx.lineWidth = 2.5; ctx.stroke();
  const lastY = 18 + (1 - (values.at(-1) - min) / Math.max(.001, max - min)) * (height - 36);
  ctx.fillStyle = "#ff6c47"; ctx.beginPath(); ctx.arc(width - 3, lastY, 5, 0, Math.PI * 2); ctx.fill();
}

async function renderPrediction() {
  const logits = await model.logits(model.tokenize("the sun rises"));
  const probs = model.probabilities(logits);
  const top = probs.map((p, i) => ({ p, token: VOCAB[i] })).filter(item => item.token !== "<BOS>").sort((a, b) => b.p - a.p).slice(0, 4);
  $("#pretrainPrediction").innerHTML = top.map(item => `<span style="flex:${Math.max(.12, item.p)}">${item.token} ${(item.p * 100).toFixed(0)}%</span>`).join("");
}

async function refreshPreference() {
  const logits = await model.logits(model.tokenize("the sun rises"));
  const east = logits[TOKEN.east];
  const west = logits[TOKEN.west];
  const margin = east - west;
  $("#scoreEast").textContent = `model score ${east.toFixed(2)}`;
  $("#scoreWest").textContent = `model score ${west.toFixed(2)}`;
  $("#alignmentMarker").style.left = `${clamp(50 + margin * 15, 2, 98)}%`;
}

function sample(probs, topP) {
  const ranked = probs.map((p, index) => ({ p, index })).sort((a, b) => b.p - a.p);
  let cumulative = 0;
  const pool = [];
  for (const item of ranked) {
    pool.push(item);
    cumulative += item.p;
    if (cumulative >= topP) break;
  }
  const poolTotal = pool.reduce((sum, item) => sum + item.p, 0);
  let pick = Math.random() * poolTotal;
  for (const item of pool) {
    pick -= item.p;
    if (pick <= 0) return item.index;
  }
  return pool[0].index;
}

function renderProbabilityBars(probs) {
  const top = probs.map((p, index) => ({ p, token: VOCAB[index] })).filter(item => item.token !== "<BOS>").sort((a, b) => b.p - a.p).slice(0, 5);
  $("#probabilityBars").innerHTML = top.map(item => `
    <div class="prob-row"><span>${item.token}</span><i><b style="width:${item.p * 100}%"></b></i><em>${(item.p * 100).toFixed(1)}%</em></div>
  `).join("");
}

async function previewInference() {
  const sequence = model.tokenize($("#promptInput").value);
  if (!sequence.length) return;
  const logits = await model.logits(sequence, true);
  renderProbabilityBars(model.probabilities(logits, Number($("#tempRange").value) / 10));
}

async function generate() {
  const button = $("#generateButton");
  button.disabled = true;
  const start = performance.now();
  const promptTokens = model.tokenize($("#promptInput").value);
  const sequence = promptTokens.length ? [...promptTokens] : [TOKEN["<BOS>"]];
  const stream = $("#tokenStream");
  stream.innerHTML = promptTokens.map(token => `<span class="token">${VOCAB[token]}</span>`).join("");
  let lastProbs = [];
  for (let i = 0; i < 4; i++) {
    const logits = await model.logits(sequence, true);
    const temperature = Number($("#tempRange").value) / 10;
    lastProbs = model.probabilities(logits, temperature);
    const token = sample(lastProbs, Number($("#topPRange").value) / 10);
    sequence.push(token);
    stream.insertAdjacentHTML("beforeend", `<span class="token generated">${VOCAB[token]}</span>`);
    await sleep(110);
  }
  renderProbabilityBars(lastProbs);
  const elapsed = performance.now() - start;
  $("#latency").textContent = `${(elapsed / 4).toFixed(1)} ms / token · ${gpu.ready ? "WebGPU" : "Wasm"}`;
  button.disabled = false;
  updateMetrics();
}

async function boot() {
  drawLoss([]);
  renderCorpus();
  try {
    await wasm.init();
    $("#wasmStatus").textContent = "Wasm ready";
    $("#wasmDot").classList.add("ready");
  } catch (error) {
    console.warn("WebAssembly kernel failed; using JavaScript fallback", error);
    $("#wasmStatus").textContent = "JS fallback";
    $("#wasmDot").classList.add("warn");
  }
  try {
    await gpu.init();
    $("#gpuStatus").textContent = "WebGPU ready";
    $("#gpuDot").classList.add("ready");
    $("#inferTag").textContent = "WEBGPU COMPUTE";
  } catch (error) {
    console.info("WebGPU unavailable; inference will use Wasm", error);
    $("#gpuStatus").textContent = "Wasm fallback";
    $("#gpuDot").classList.add("warn");
    $("#inferTag").textContent = "WASM FALLBACK";
    $("#inferTag").classList.remove("gpu");
  }
  updateMetrics();
  await renderPrediction();
  await refreshPreference();

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(console.warn);
}

$$('.stage-tab').forEach(tab => tab.addEventListener("click", () => setStage(tab.dataset.stage)));
$$('[data-jump]').forEach(button => button.addEventListener("click", () => setStage(button.dataset.jump)));
$("#corpusSelect").addEventListener("change", renderCorpus);
$("#epochsRange").addEventListener("input", event => $("#epochsOutput").textContent = event.target.value);
$("#tempRange").addEventListener("input", event => { $("#tempOutput").textContent = (event.target.value / 10).toFixed(1); previewInference(); });
$("#topPRange").addEventListener("input", event => $("#topPOutput").textContent = (event.target.value / 10).toFixed(2));
$("#promptInput").addEventListener("input", previewInference);
$$('[data-prompt]').forEach(button => button.addEventListener("click", () => { $("#promptInput").value = button.dataset.prompt; previewInference(); }));

$("#trainButton").addEventListener("click", async () => {
  const button = $("#trainButton");
  button.disabled = true;
  button.innerHTML = "Training on-device… <span>◌</span>";
  const losses = [];
  const epochs = Number($("#epochsRange").value);
  const lines = CORPORA[$("#corpusSelect").value];
  await model.train(lines, epochs, (epoch, loss) => {
    losses.push(loss);
    if (epoch % 2 === 0 || epoch === epochs - 1) {
      drawLoss(losses);
      $("#lossDelta").textContent = `epoch ${epoch + 1} · ${loss.toFixed(3)}`;
      updateMetrics();
    }
  });
  $("#lossDelta").textContent = `${((1 - losses.at(-1) / losses[0]) * 100).toFixed(0)}% lower`;
  await renderPrediction();
  await refreshPreference();
  button.disabled = false;
  button.innerHTML = "Train another pass <span>↗</span>";
});

$$('.candidate').forEach(button => button.addEventListener("click", async () => {
  model.preference("the sun rises", button.dataset.prefer, button.dataset.reject);
  $$('.candidate').forEach(candidate => candidate.classList.toggle("selected", candidate === button));
  $("#preferenceMessage").textContent = `Updated θ: “${button.dataset.prefer}” moved up relative to “${button.dataset.reject}”.`;
  await refreshPreference();
  await renderPrediction();
  updateMetrics();
}));

$("#generateButton").addEventListener("click", generate);
$("#resetModel").addEventListener("click", async () => {
  model.reset();
  drawLoss([]);
  $("#lossDelta").textContent = "not trained";
  $("#preferenceMessage").textContent = "Model reset. Choose a response to apply one preference step.";
  $$('.candidate').forEach(candidate => candidate.classList.remove("selected"));
  await renderPrediction();
  await refreshPreference();
  updateMetrics();
});

window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  deferredInstall = event;
  $("#installButton").hidden = false;
});
$("#installButton").addEventListener("click", async () => {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  await deferredInstall.userChoice;
  deferredInstall = null;
  $("#installButton").hidden = true;
});

boot();
