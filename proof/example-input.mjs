import { randomBytes } from "node:crypto";
import { buildPoseidon } from "circomlibjs";

const rawAmount = process.argv[2] ?? "12000";
if (!/^[0-9]{1,5}$/.test(rawAmount)) throw new Error("Use a whole-euro amount below 100,000.");

const amount = BigInt(rawAmount);
// 248 random bits are below the BN254 scalar field modulus.
const salt = BigInt("0x" + randomBytes(31).toString("hex"));
const poseidon = await buildPoseidon();
const commitment = poseidon.F.toObject(poseidon([1n, amount, salt]));
process.stdout.write(JSON.stringify({
  amount: amount.toString(),
  salt: salt.toString(),
  commitment: commitment.toString()
}) + "\n");
