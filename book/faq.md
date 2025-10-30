# FAQ

**Q: Why only 21 CUs?**
A: Doppler uses direct memory operations, inline assembly optimizations, and zero-overhead abstractions to achieve minimal compute usage.

**Q: Can I use custom payload types?**
A: Yes! Doppler is generic over any `Copy` type. Define your structure and use it with the SDK.

**Q: How do I handle oracle account creation?**
A: However you like, but if you use Solana's `create_account_with_seed` instruction with the admin as the base key it's cheaper!

**Q: What's the maximum update frequency?**
A: Limited only by Solana's throughput. With 21 CUs, you can update as fast as you land.