; Doppler, as `doppler::generate` emits it for a one-u64 payload. sBPF v3.
; r1 = serialized input (account 0: admin, account 1: feed), r2 = instruction data.
; Instruction data and feed data share one layout: sequence (u64 LE, strictly increasing), then the payload.
; Assumed, not checked: account 0 carries no data (so account 1's data sits at 0x28c0), the feed
; account is 8 + payload bytes, the instruction data is 8 + payload bytes. Only the admin's own
; signed transaction reaches the write path, and `deploy` sizes the feed account.

  ldxh   r3, [r1+0x08]        ; account 0 flags: 0xff "not a duplicate", then is_signer
  jne    r3, 0x1ff, fail
  ldxdw  r3, [r1+0x10]        ; account 0 key == ADMIN, 8 bytes at a time
  lddw   r4, ADMIN[0..8]
  jne    r3, r4, fail
  ldxdw  r3, [r1+0x18]
  lddw   r4, ADMIN[8..16]
  jne    r3, r4, fail
  ldxdw  r3, [r1+0x20]
  lddw   r4, ADMIN[16..24]
  jne    r3, r4, fail
  ldxdw  r3, [r1+0x28]
  lddw   r4, ADMIN[24..32]
  jne    r3, r4, fail
  ldxdw  r3, [r1+0x28c0]      ; stored sequence
  ldxdw  r4, [r2+0x00]        ; new sequence
  jlt    r3, r4, ok           ; must strictly increase
fail:
  mov64  r0, 1                ; falls through; a non-zero exit discards the writes below
ok:
  stxdw  [r1+0x28c0], r4      ; write the sequence
  ldxdw  r4, [r2+0x08]        ; copy the payload: one load/store pair per 8, 4, 2 or 1 bytes
  stxdw  [r1+0x28c8], r4
  exit                        ; 22 instructions, 21 executed, 21 compute units

; From six load/store pairs the copy becomes one syscall, and `fail` must exit before it:
;   jlt    r3, r4, ok
; fail:
;   mov64  r0, 1
;   exit
; ok:
;   mov64  r3, 8 + payload_size
;   add64  r1, 0x28c0
;   call   sol_memcpy_         ; (dst = r1, src = r2, n = r3): sequence and payload at once
;   exit
