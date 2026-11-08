# Repository agent instructions

## Authorized GitHub branch

- The user authorizes ongoing development and routine updates on `jason/bjs-extraction-foundation` in `homedeals18/50toc-buying-engine`. Do not request confirmation for each normal change on that branch.
- Never modify, merge into, push to, rename, delete, or otherwise update `main` or any other GitHub branch. Do not create another branch as a substitute. Reading other branches for comparison is allowed.
- Before changing a remote branch reference, verify the repository, exact target branch and current head. Update only `refs/heads/jason/bjs-extraction-foundation`, using a normal fast-forward and an expected-head check. Reconcile concurrent Jason changes before retrying.
- Never use a command that updates multiple remote branches, such as `git push --all` or `git push --mirror`.

## Working area

Continue application development in `Jason/`. Preserve the inherited application directories while building the agreed modules. Keep credentials, database files, browser profiles, receipts and other private runtime data out of Git.

These are agent operating instructions, not GitHub-enforced branch protection settings.
