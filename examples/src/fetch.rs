use doppler_sdk::Oracle;
use solana_client::rpc_client::RpcClient;
use solana_pubkey::Pubkey;

pub fn oracle_account<T: Sized + Copy>(
    client: &RpcClient,
    oracle_pubkey: &Pubkey,
) -> Option<Oracle<T>> {
    client
        .get_account_data(oracle_pubkey)
        .ok()
        .map(|b| Oracle::<T>::from_bytes(b.as_slice()))
}
