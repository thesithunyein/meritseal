pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";

// Public commitment is Poseidon(policy version, whole-euro amount, private salt).
// A valid proof establishes the published range, not applicant identity or award eligibility.
template NlnetFirstGrantAmountV1() {
    signal input amount;
    signal input salt;
    signal input commitment;

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
    digest.inputs[0] <== 1;
    digest.inputs[1] <== amount;
    digest.inputs[2] <== salt;
    digest.out === commitment;
}

component main {public [commitment]} = NlnetFirstGrantAmountV1();
