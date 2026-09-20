# =====================================================================
# WHAT HAPPENED TO A BROWSER SUITE — THE ONE PLACE THAT DECIDES
#
# L28. The runner used to ask its questions in the wrong order. It looked at
# the suite's OUTPUT first and its EXIT STATUS second, so a suite that exited
# non-zero having recorded no PASS lines fell past every failure branch and
# printed `ok`. The gate still went red through the separate "recorded no
# assertions" check, so the VERDICT was right and no failed suite was ever
# accepted as a green release -- but the word printed beside it was false, and
# a status line that lies is the thing this harness exists not to do.
#
# The rule, and the reason it is a rule:
#
#   THE PROCESS EXIT RESULT IS AUTHORITATIVE FOR PROCESS SUCCESS.
#
# Never infer that a suite succeeded from its PASS count, its FAIL count, the
# presence of output, how long it ran, or whether its browser went away. Those
# are assertion accounting, which is an ADDITIONAL invariant -- a suite that
# exits 0 having proved nothing is still a gate failure -- never a substitute
# for asking the operating system what happened.
#
# This file is sourced by scripts/run-platform-tests.sh and exercised by
# supabase/tests/js/runner_exit_truth.test.mts against real child processes
# with real exit codes, so the runner's decision and the test's subject are
# the same code rather than two copies of one condition.
# =====================================================================

# classify_suite_outcome <exit_status> <pass_count> <fail_count>
#
# Echoes exactly one of: ok | KILL | FAIL | CRASH | EMPTY
#
# Order is the whole point. Exit status is asked first, EXCEPT that a suite
# which recorded its own assertion failures is named FAIL rather than CRASH --
# a suite reporting "this assertion about the product was false" and exiting 1
# has finished and told the truth, and calling that a crash would lose the one
# diagnostic that matters. Every other non-zero exit is CRASH, whatever the
# output looked like.
classify_suite_outcome() {
  local status="$1" passes="$2" failures="$3"

  # The kernel stopped it. Nothing about the product failed.
  if [[ "$status" -eq 137 ]]; then
    echo "KILL"
    return 0
  fi

  # The suite finished and reported product assertions that were false.
  if [[ "$failures" -gt 0 ]]; then
    echo "FAIL"
    return 0
  fi

  # Any other non-zero exit: the suite did not finish, and did not say why in
  # its own assertions. This branch deliberately carries NO condition on the
  # pass count -- requiring one recorded pass here is precisely the defect
  # L28 names.
  if [[ "$status" -ne 0 ]]; then
    echo "CRASH"
    return 0
  fi

  # Exited cleanly having proved nothing. A silent zero reads exactly like a
  # clean run and must not be allowed to.
  if [[ "$passes" -eq 0 ]]; then
    echo "EMPTY"
    return 0
  fi

  echo "ok"
}

# suite_outcome_is_failure <outcome>
#
# True for everything that is not `ok`. Kept as a function rather than an
# inline test so that the runner and the regression cannot drift about which
# outcomes are allowed to leave the gate green.
suite_outcome_is_failure() {
  [[ "$1" != "ok" ]]
}
