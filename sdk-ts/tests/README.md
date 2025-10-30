# Integration Test Setup

Run the tests after setting up the local validator with Doppler deployed:

1. **Start validator + deploy program:**
   ```bash
   cd doppler
   chmod +x ./test-validator.sh   # run once if needed
   ./test-validator.sh
   ```

2. **Run the SDK tests (new terminal):**
   ```bash
   cd doppler/sdk-ts
   bun test
   ```

The test suite assumes `test-validator.sh` is running in another terminal; it does not manage the validator lifecycle itself.
