import crypto from "crypto";

// AES-256-GCM encryption for secure key storage
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 16;
const KEY_LENGTH = 32;
const PBKDF2_ITERATIONS = 100000;

/**
 * Derive a 256-bit key from a password using PBKDF2.
 */
function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, "sha256");
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns a base64-encoded string containing: salt (16) + iv (12) + authTag (16) + ciphertext
 * 
 * @param plaintext - The text to encrypt (e.g., a private key)
 * @param password - The encryption password
 * @returns Base64-encoded encrypted string
 */
export function encrypt(plaintext: string, password: string): string {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = deriveKey(password, salt);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Combine: salt + iv + authTag + ciphertext
  const combined = Buffer.concat([salt, iv, authTag, encrypted]);
  return combined.toString("base64");
}

/**
 * Decrypt a base64-encoded encrypted string using AES-256-GCM.
 * 
 * @param encryptedBase64 - The base64-encoded encrypted string
 * @param password - The decryption password
 * @returns The decrypted plaintext
 * @throws Error if decryption fails (wrong password or corrupted data)
 */
export function decrypt(encryptedBase64: string, password: string): string {
  const combined = Buffer.from(encryptedBase64, "base64");

  // Extract components
  const salt = combined.subarray(0, SALT_LENGTH);
  const iv = combined.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const authTag = combined.subarray(
    SALT_LENGTH + IV_LENGTH,
    SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH
  );
  const ciphertext = combined.subarray(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);

  const key = deriveKey(password, salt);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  try {
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString("utf8");
  } catch (error) {
    throw new Error("Decryption failed: Invalid password or corrupted data");
  }
}

/**
 * Check if a string looks like an encrypted key (base64-encoded).
 * Encrypted keys are longer due to salt + iv + authTag overhead.
 */
export function isEncryptedKey(key: string): boolean {
  // Encrypted keys have minimum overhead: 16 (salt) + 12 (iv) + 16 (authTag) = 44 bytes
  // Plus the 64-byte private key, total ~108+ bytes when base64 encoded
  // A raw hex private key is exactly 64 characters (or 66 with 0x prefix)
  if (/^(0x)?[0-9a-fA-F]{64}$/.test(key)) {
    return false; // Raw hex private key
  }
  
  try {
    const decoded = Buffer.from(key, "base64");
    // Minimum size: salt (16) + iv (12) + authTag (16) + at least 1 byte ciphertext
    return decoded.length >= SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH + 1;
  } catch {
    return false;
  }
}

/**
 * CLI utility to encrypt a private key.
 * Usage: npx ts-node src/utils/crypto.ts encrypt <privateKey> <password>
 */
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === "encrypt") {
    const privateKey = args[1];
    const password = args[2];

    if (!privateKey || !password) {
      console.error("Usage: npx ts-node src/utils/crypto.ts encrypt <privateKey> <password>");
      process.exit(1);
    }

    const encrypted = encrypt(privateKey, password);
    console.log("\n🔐 Encrypted Private Key:\n");
    console.log(encrypted);
    console.log("\n📝 Add this to your .env file as:");
    console.log("PRIVATE_KEY_ENCRYPTED=" + encrypted);
    console.log("ENCRYPTION_PASSWORD=<your-password>");
    console.log("\nOr use KEY_PASSWORD env var at runtime.\n");
  } else if (command === "decrypt") {
    const encryptedKey = args[1];
    const password = args[2];

    if (!encryptedKey || !password) {
      console.error("Usage: npx ts-node src/utils/crypto.ts decrypt <encryptedKey> <password>");
      process.exit(1);
    }

    try {
      const decrypted = decrypt(encryptedKey, password);
      console.log("\n🔓 Decrypted Private Key:\n");
      console.log(decrypted);
    } catch (err) {
      console.error("\n❌ Decryption failed:", (err as Error).message);
      process.exit(1);
    }
  } else {
    console.log("Polymarket Bot - Key Encryption Utility");
    console.log("\nCommands:");
    console.log("  encrypt <privateKey> <password>  - Encrypt a private key");
    console.log("  decrypt <encryptedKey> <password> - Decrypt an encrypted key");
  }
}
