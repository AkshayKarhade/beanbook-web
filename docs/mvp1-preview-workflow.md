# BeanBook MVP-1 review workflow

- Production: `main` on the Netlify staging project's production-branch setting (verify before release).
- Integration: `BeanBook-MVP-1` is enabled under **Branch deploys > individual branches**.
- Feature PRs target `BeanBook-MVP-1`; Netlify **Deploy Previews** is enabled for PRs against the production or branch-deploy branches.
- Use the PR's Netlify check to open its preview; do not assume a URL is live until Netlify confirms a successful deploy.
- For the business console, navigate to `/beanbook/admin` within the preview.
- A preview URL is not a separate database. Verify the Supabase environment and avoid inserting test records into production during smoke tests.
- Don't merge into `main` until code, build, owner permissions and critical checkout regressions have passed.

If a PR predates a branch's activation as a Netlify branch-deploy target, push a new documentation-only or code commit to trigger a fresh deployment check.
