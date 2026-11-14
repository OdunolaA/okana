# Changelog

## v2.0.0 · November 2026

### New
- **Product health page.** Open bugs by priority, fix time against targets, bugs opened vs fixed for the selected period, time from idea to feature, backlog age, roadmap health and feature completeness. A "Needs attention" list explains what's off target, and every measure has a red, amber or green status.
- **Documents page.** Policy and compliance documents (GDPR, security, export control, legal and AI) with owners, review dates and sharing rules. Overdue and soon-due reviews are flagged, and common client questions link to the document that answers them.
- **Documents to send (Sales view).** Sales sees only documents cleared for clients, with a one-click list to paste into an email.
- The Jira sync now reads bugs, done epics and backlog items for Product health.
- Documents can be managed in `data/documents.json`, with no API needed.

### Changed
- Navigation: Product health and Documents moved out of "Coming in v2". Geo position, Transformation readiness and Sales status are now planned for v3.
- Wording follows Jira's rename of projects to spaces.

## v1.0.0 · November 2026

First release: Setup guide, About the product, Product progress, Market position with the Okana score, and the Sales view (Demo prep). Live sprint, velocity, roadmap and milestone data from Jira through an hourly GitHub Action, published on GitHub Pages.
