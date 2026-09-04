; Doppler for payloads of up to five 8-byte chunks, shown for one; `generate` patches ADMIN,
; repeats the copy pair once per chunk, and sizes the ELF. sBPF v3, 21 compute units for one chunk.
;
; r1 = serialized input (account 0: admin, account 1: feed), r2 = instruction data.
; Instruction data and feed data share one layout: sequence (u64 LE, strictly increasing), then the
; payload, padded to 8 bytes.
;
; Assumed, not checked: account 0 carries no data (so account 1's data sits at 0x28c0), the feed
; account and the instruction data are 8 + padded payload bytes. Only the admin's own signed
; transaction reaches the write path, and `deploy` sizes the feed account.
;
; Comments are stripped before assembling. Assembled by tests/templates.rs into doppler.so.

.globl entrypoint
entrypoint:
  ldxh   r3, [r1+0x08]        ; account 0 flags: 0xff "not a duplicate", then is_signer
  jne    r3, 0x1ff, fail
  ldxdw  r3, [r1+0x10]        ; account 0 key == ADMIN, 8 bytes at a time
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
  ldxdw  r3, [r1+0x28c0]      ; stored sequence
  ldxdw  r4, [r2+0x00]        ; new sequence
  jlt    r3, r4, ok           ; must strictly increase
fail:
  mov64  r0, 1                ; falls through; a non-zero exit discards the writes below
ok:
  stxdw  [r1+0x28c0], r4      ; write the sequence
  ldxdw  r4, [r2+0x08]        ; the copy pair, once per 8 bytes with both offsets advanced
  stxdw  [r1+0x28c8], r4
  exit
