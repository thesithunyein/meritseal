// Builds the NLnet amount circuit and a Groth16 key, then copies the browser/server artifacts
// into agent/public/zk/. Run from the repository root:
//   npm install
//   node proof/setup.mjs                      # local two-phase ceremony with fresh entropy
//   node proof/setup.mjs --ptau path/to.ptau  # reuse a public Powers of Tau file (recommended)
// Requires circom 2.1.6+ on PATH (https://docs.circom.io/getting-started/installation/).
import { execSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";

const build = "proof/build";
const out = "agent/public/zk";
const ptauArg = process.argv.indexOf("--ptau");
const externalPtau = ptauArg > -1 ? process.argv[ptauArg + 1] : null;
const entropy = () => randomBytes(32).toString("hex");
const run = (cmd) => { console.log(`> ${cmd.replace(/-e="[0-9a-f]+"/g, '-e="<random>"')}`); execSync(cmd, { stdio: "inherit" }); };

await mkdir(build, { recursive: true });
await mkdir(out, { recursive: true });

run(`circom proof/nlnet-amount.circom --r1cs --wasm -l node_modules -o ${build}`);

let ptau = externalPtau;
if (!ptau) {
  // 2^12 constraints is ample: the circuit uses Num2Bits(16), two LessEqThan(16) and Poseidon(3).
  run(`npx snarkjs powersoftau new bn128 12 ${build}/pot_0000.ptau`);
  run(`npx snarkjs powersoftau contribute ${build}/pot_0000.ptau ${build}/pot_0001.ptau --name="MeritSeal phase 1" -e="${entropy()}"`);
  run(`npx snarkjs powersoftau prepare phase2 ${build}/pot_0001.ptau ${build}/pot_final.ptau`);
  ptau = `${build}/pot_final.ptau`;
}

run(`npx snarkjs groth16 setup ${build}/nlnet-amount.r1cs ${ptau} ${build}/nlnet-amount_0000.zkey`);
run(`npx snarkjs zkey contribute ${build}/nlnet-amount_0000.zkey ${build}/nlnet-amount.zkey --name="MeritSeal phase 2" -e="${entropy()}"`);
run(`npx snarkjs zkey export verificationkey ${build}/nlnet-amount.zkey ${build}/vkey.json`);

await copyFile(`${build}/nlnet-amount_js/nlnet-amount.wasm`, `${out}/nlnet-amount.wasm`);
await copyFile(`${build}/nlnet-amount.zkey`, `${out}/nlnet-amount.zkey`);
await copyFile(`${build}/vkey.json`, `${out}/vkey.json`);
await copyFile("node_modules/snarkjs/build/snarkjs.min.js", `${out}/snarkjs.min.js`);

const vkeyRaw = await readFile(`${build}/vkey.json`);
const manifest = {
  policy_id: "nlnet-first-grant-amount:v1",
  statement: "The committed whole-euro amount is between €5,000 and €50,000 inclusive.",
  circuit: "proof/nlnet-amount.circom",
  public_signals: ["commitment = Poseidon(1, amount, salt)"],
  vkey_sha256: createHash("sha256").update(JSON.stringify(JSON.parse(vkeyRaw))).digest("hex"),
  setup: externalPtau ? `Public Powers of Tau (${externalPtau.split(/[\\/]/).pop()}) + one phase-2 contribution` : "Single-party local ceremony (phase 1 and phase 2) with fresh random entropy",
  created_at: new Date().toISOString()
};
await writeFile(`${out}/manifest.json`, JSON.stringify(manifest, null, 2) + "\n");
console.log(`\nArtifacts written to ${out}. vkey_sha256=${manifest.vkey_sha256}`);
console.log("Next: node proof/verify-boundaries.mjs");
