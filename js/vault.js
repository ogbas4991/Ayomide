/* Ayomide Studio — app-lock & encrypted vault state */
import { kvGet, kvSet } from './db.js';
import { sha256Hex, deriveKey, randomHex } from './utils.js';

let vaultKey = null; // CryptoKey in memory after unlock

export const vaultReady = () => !!vaultKey;
export const getVaultKey = () => vaultKey;
export const setVaultKey = (k) => { vaultKey = k; };

export async function lockConfig() { return kvGet('lock', null); }

export async function setupLock(pin) {
  const salt = randomHex(16);
  const vaultSalt = randomHex(16);
  await kvSet('lock', {
    salt,
    vaultSalt,
    pinHash: await sha256Hex(pin + salt)
  });
}

export async function disableLock() { await kvSet('lock', null); vaultKey = null; }

export async function verifyPin(pin) {
  const cfg = await lockConfig();
  if (!cfg) return false;
  return (await sha256Hex(pin + cfg.salt)) === cfg.pinHash;
}

export async function unlockVault(pin) {
  const cfg = await lockConfig();
  if (!cfg) throw new Error('Lock is not enabled');
  if (!(await verifyPin(pin))) throw new Error('Wrong PIN');
  vaultKey = await deriveKey(pin, cfg.vaultSalt);
  return vaultKey;
}
