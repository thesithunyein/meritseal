pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";

// Proves: "the committed whole-euro amount is within NLnet's €5,000–€50,000 first-grant range".
// Private inputs: amount, salt. Public output: commitment = Poseidon(policyVersion, amount, salt).
// The commitment lets the applicant later open the exact amount to the funder; nobody else learns it.
// A valid proof establishes the range only, not applicant identity or award eligibility.
template NlnetFirstGrantAmountV1() {
    signal input amount;
    signal input salt;
    signal output commitment;

    // Bound the amount to 16 bits (max 65,535) so the comparators below are sound.
    component amountBits = Num2Bits(16);
    amountBits.in <== amount;

    component lower = LessEqThan(16);
    lower.in[0] <== 5000;
    lower.in[1] <== amount;
    lower.out === 1;

    component upper = LessEqThan(16);
    upper.in[0] <== amount;
    upper.in[1] <== 50000;
    upper.out === 1;

    component digest = Poseidon(3);
    digest.inputs[0] <== 1;      // policy version: nlnet-first-grant-amount:v1
    digest.inputs[1] <== amount;
    digest.inputs[2] <== salt;
    commitment <== digest.out;
}

component main = NlnetFirstGrantAmountV1();
