# STORY 002 approval inbox prototype

Internal synthetic prototype for Work Queue item LOAFWISE STORY 20261006 002.

It renders only the signed in account's approval records, shows age, expiry, stale state and source, provides a clear empty state, and routes approve or reject decisions through the accepted STORY 001 pure decision module. External actions remain disabled. Customer text is inserted with `textContent`, so hostile strings remain inert data.

Run:

`node --test *.test.mjs`

This branch is not a staging deployment or release. Remaining acceptance work is a deployed staging URL, screenshot evidence, accessibility and browser verification, independent QA, and Security review of the integrated path.
