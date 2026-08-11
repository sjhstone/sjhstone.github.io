(module
  (memory (export "memory") 2)

  ;; Dot product for the CPU inference/training path.
  (func (export "dot") (param $a i32) (param $b i32) (param $len i32) (result f32)
    (local $i i32)
    (local $sum f32)
    (block $done
      (loop $loop
        local.get $i
        local.get $len
        i32.ge_u
        br_if $done

        local.get $sum
        local.get $a
        local.get $i
        i32.const 4
        i32.mul
        i32.add
        f32.load
        local.get $b
        local.get $i
        i32.const 4
        i32.mul
        i32.add
        f32.load
        f32.mul
        f32.add
        local.set $sum

        local.get $i
        i32.const 1
        i32.add
        local.set $i
        br $loop
      )
    )
    local.get $sum
  )

  ;; In-place SGD update: weights[i] -= learning_rate * gradient[i].
  (func (export "sgd") (param $weights i32) (param $gradient i32) (param $rate f32) (param $len i32)
    (local $i i32)
    (local $address i32)
    (block $done
      (loop $loop
        local.get $i
        local.get $len
        i32.ge_u
        br_if $done

        local.get $weights
        local.get $i
        i32.const 4
        i32.mul
        i32.add
        local.tee $address
        local.get $address
        f32.load
        local.get $gradient
        local.get $i
        i32.const 4
        i32.mul
        i32.add
        f32.load
        local.get $rate
        f32.mul
        f32.sub
        f32.store

        local.get $i
        i32.const 1
        i32.add
        local.set $i
        br $loop
      )
    )
  )

  (func (export "argmax") (param $values i32) (param $len i32) (result i32)
    (local $i i32)
    (local $best i32)
    (local $best_value f32)
    local.get $values
    f32.load
    local.set $best_value
    i32.const 1
    local.set $i
    (block $done
      (loop $loop
        local.get $i
        local.get $len
        i32.ge_u
        br_if $done
        local.get $values
        local.get $i
        i32.const 4
        i32.mul
        i32.add
        f32.load
        local.get $best_value
        f32.gt
        (if
          (then
            local.get $values
            local.get $i
            i32.const 4
            i32.mul
            i32.add
            f32.load
            local.set $best_value
            local.get $i
            local.set $best
          )
        )
        local.get $i
        i32.const 1
        i32.add
        local.set $i
        br $loop
      )
    )
    local.get $best
  )
)
