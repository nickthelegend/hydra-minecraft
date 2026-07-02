// One-time local-dev credential + genesis-UTxO setup.
//
// Generates (idempotently, only if missing):
//   docker/credentials/payment.sk   - hex-encoded Ed25519 signing key (server-side only)
//   docker/credentials/hydra.sk     - hydra-node signing key (TextEnvelope)
//   docker/credentials/utxo.json    - initial UTxO seeding the offline head
//
// DEV ONLY: these keys hold no real value (offline head, fake lovelace).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import CSL from '@emurgo/cardano-serialization-lib-nodejs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const credDir = path.join(root, 'docker', 'credentials');

export const GENESIS_TX_ID = '0'.repeat(64);
export const SEED_LOVELACE = 1_000_000_000_000n; // 1M ADA of offline play-money

export function loadCredentials() {
  const skPath = path.join(credDir, 'payment.sk');
  const skHex = fs.readFileSync(skPath, 'utf8').trim();
  const privKey = CSL.PrivateKey.from_normal_bytes(Buffer.from(skHex, 'hex'));
  const pubKey = privKey.to_public();
  const cred = CSL.Credential.from_keyhash(pubKey.hash());
  const address = CSL.EnterpriseAddress.new(0 /* testnet */, cred).to_address();
  return { privKey, pubKey, address, addressBech32: address.to_bech32('addr_test') };
}

export function runSetup() {
  fs.mkdirSync(credDir, { recursive: true });

  const skPath = path.join(credDir, 'payment.sk');
  if (!fs.existsSync(skPath)) {
    fs.writeFileSync(skPath, crypto.randomBytes(32).toString('hex') + '\n', { mode: 0o600 });
    console.log('[setup] generated payment signing key');
  }

  const hydraSkPath = path.join(credDir, 'hydra.sk');
  if (!fs.existsSync(hydraSkPath)) {
    const envelope = {
      type: 'HydraSigningKey_ed25519',
      description: 'hydra-minecraft offline dev key',
      cborHex: '5820' + crypto.randomBytes(32).toString('hex'),
    };
    fs.writeFileSync(hydraSkPath, JSON.stringify(envelope, null, 2) + '\n', { mode: 0o600 });
    console.log('[setup] generated hydra signing key');
  }

  const { addressBech32 } = loadCredentials();
  const utxoPath = path.join(credDir, 'utxo.json');
  if (!fs.existsSync(utxoPath)) {
    const utxo = {
      [`${GENESIS_TX_ID}#0`]: {
        address: addressBech32,
        value: { lovelace: Number(SEED_LOVELACE) },
      },
    };
    fs.writeFileSync(utxoPath, JSON.stringify(utxo, null, 2) + '\n');
    console.log('[setup] wrote initial UTxO for offline head');
  }

  console.log(`[setup] relay address: ${addressBech32}`);
  return { addressBech32 };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runSetup();
}
