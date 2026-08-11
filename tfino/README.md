# TF · IN / OUT

An installable, offline-capable browser lab that explains the three operational stages of a Transformer-based language model: pretraining, post-training, and inference.

## What is real in the toy

- A 10-token vocabulary and 8-dimensional token embeddings.
- One causal self-attention head. The final prompt token acts as the query; visible earlier tokens supply keys and values.
- A trainable 10 × 8 language-model head shared by all three stages.
- Cross-entropy next-token pretraining with stochastic gradient descent.
- A pairwise logistic preference update, used as a compact analogue of DPO/RLHF-style ranking.
- Autoregressive inference with temperature and nucleus (top-p) sampling.
- An actual WebGPU compute shader for the output projection `logits = W × hidden`.
- Actual WebAssembly kernels for dot products and in-place SGD, also used as the inference fallback.

The frozen attention block and microscopic corpus make the process understandable; they do not reproduce the scale, emergent capabilities, distributed training, or full optimization stack of a production LLM.

## Files

| File | Role |
| --- | --- |
| `index.html` | Accessible, responsive lab interface |
| `styles.css` | Editorial UI and responsive layouts |
| `app.js` | Model, training loop, sampling, WebGPU backend, and inline compiled Wasm module |
| `kernels.wat` | Readable WebAssembly source for dot/SGD/argmax kernels |
| `sw.js` | Offline cache service worker |
| `manifest.webmanifest` | Install metadata |

## Run locally

The service worker requires an HTTP origin rather than opening the file directly.

```sh
python3 -m http.server 8080
```

Then open `http://localhost:8080/tfino/`. WebGPU needs a supporting browser and secure context; `localhost` counts as secure. When WebGPU is unavailable, the page labels and uses its Wasm fallback.

To rebuild the binary represented inline in `app.js` after editing `kernels.wat`:

```sh
npm exec --yes --package=wabt -- wat2wasm tfino/kernels.wat -o tfino/kernels.wasm
```

Then base64-encode the 274-byte result and replace `WASM_BASE64` in `app.js`.
