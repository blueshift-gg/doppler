; Doppler for payloads of six 8-byte chunks or more, shown for six: one `sol_memcpy_` of the
; sequence and the payload at once, 31 compute units. `generate` patches ADMIN and the length.
; The checks are those of doppler.s; `fail` exits before the call.
;
; Comments are stripped before assembling. Assembled by tests/templates.rs into doppler-memcpy.so.

.globl entrypoint
entrypoint:
  ldxh   r3, [r1+0x08]
  jne    r3, 0x1ff, fail
  ldxdw  r3, [r1+0x10]
  lddw   r4, 0x0              ; ADMIN[0..8]
  jne    r3, r4, fail
  ldxdw  r3, [r1+0x18]
  lddw   r4, 0x0              ; ADMIN[8..16]
  jne    r3, r4, fail
  ldxdw  r3, [r1+0x20]
  lddw   r4, 0x0              ; ADMIN[16..24]
  jne    r3, r4, fail
  ldxdw  r3, [r1+0x28]
  lddw   r4, 0x0              ; ADMIN[24..32]
  jne    r3, r4, fail
  ldxdw  r3, [r1+0x28c0]
  ldxdw  r4, [r2+0x00]
  jlt    r3, r4, ok
fail:
  mov64  r0, 1
  exit
ok:
  mov64  r3, 56               ; 8 + padded payload
  add64  r1, 0x28c0
  call   sol_memcpy_          ; (dst = r1, src = r2, n = r3)
  exit
