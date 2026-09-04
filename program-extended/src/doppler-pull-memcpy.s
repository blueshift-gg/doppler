// doppler-pull.s for payloads of six chunks or more: the copy is one `sol_memcpy_`, as in
// doppler/doppler-memcpy.s. `generate_pull` patches ADMIN and the length. Comments are stripped
// before assembling.

.globl entrypoint
entrypoint:
  ldxh   r3, [r1+0x08]
  jne    r3, 0x1ff, detached  // not the admin signing: `pull` in oracle.rs, placed right after
  ldxdw  r3, [r1+0x10]
  lddw   r4, 0x0              // ADMIN[0..8]
  jne    r3, r4, fail
  ldxdw  r3, [r1+0x18]
  lddw   r4, 0x0              // ADMIN[8..16]
  jne    r3, r4, fail
  ldxdw  r3, [r1+0x20]
  lddw   r4, 0x0              // ADMIN[16..24]
  jne    r3, r4, fail
  ldxdw  r3, [r1+0x28]
  lddw   r4, 0x0              // ADMIN[24..32]
  jne    r3, r4, fail
  ldxdw  r3, [r1+0x28c0]
  ldxdw  r4, [r2+0x00]
  jlt    r3, r4, ok
fail:
  mov64  r0, 1
  exit
ok:
  mov64  r3, 56               // 8 + padded payload
  add64  r1, 0x28c0
  call   0x717cc4a3             // sol_memcpy_ by its murmur3 hash: v3 has no relocations
  exit
detached:
