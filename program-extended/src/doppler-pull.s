// The push path of doppler/doppler.s, and a second path for anyone carrying the admin's detached
// signature: an instruction whose first account is not the admin signing falls off the end into
// `pull` in oracle.rs, which the linker places right after this module-level asm. There is no
// caller, so `pull` returning is the program exiting with its code. `doppler::generate_pull`
// patches ADMIN, repeats the copy pair once per chunk, moves the `detached` jump past the pairs,
// and sizes the ELF. Comments are stripped before assembling.

.globl entrypoint
entrypoint:
  ldxh   r3, [r1+0x08]        // account 0 flags: 0xff "not a duplicate", then is_signer
  jne    r3, 0x1ff, detached  // not the admin signing: `pull` in oracle.rs, placed right after
  ldxdw  r3, [r1+0x10]        // account 0 key == ADMIN, 8 bytes at a time
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
  ldxdw  r3, [r1+0x28c0]      // stored sequence
  ldxdw  r4, [r2+0x00]        // new sequence
  jlt    r3, r4, ok           // must strictly increase
fail:
  mov64  r0, 1                // falls through; a non-zero exit discards the writes below
ok:
  stxdw  [r1+0x28c0], r4      // write the sequence
  ldxdw  r4, [r2+0x08]        // the copy pair, once per 8 bytes with both offsets advanced
  stxdw  [r1+0x28c8], r4
  exit
detached:
