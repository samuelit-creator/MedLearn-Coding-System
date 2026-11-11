# VCS Implementation Guide (SOC 2 Evidence)

This document describes how our organization implements and provides evidence for the **Software Development & Change Management Policy**.

## 1. VCS Access Approval (Requirement 1.1)
**Control**: Access to the VCS must be approved by a system admin.

**How we do it**: 
- Access requests are submitted via [Email/Slack/Ticket].
- The [CTO/System Admin] grants access in the [GitHub/GitLab] organization settings.

**Audit Evidence**:
- A screenshot of the "Members" list in our VCS showing approved users.
- A sample approval email or ticket for the most recent hire.

**How to Collect (GitHub)**:
1. Navigate to your **GitHub Organization**.
2. Click on the **People** tab.
3. Take a screenshot showing the list of members and their roles.
4. Save as `evidence/access/vcs_members_list.png`.

## 2. Change Management & Review (Requirement 1.2)
**Control**: All changes are reviewed and approved.

**How we do it**:
- We use **Pull Requests (PRs)** in [GitHub/GitLab].
- We have enabled "Branch Protection Rules" on the `main` branch, requiring at least 1 approved review and passing status checks.

**Audit Evidence**:
- A screenshot of the Branch Protection Rules for the primary repository.
- A PDF export of a recent, merged Pull Request.

**How to Collect (GitHub)**:
1.  **Branch Protection**:
    - Go to your repository **Settings** > **Branches**.
    - Take a screenshot of the `main` or `master` branch protection rules (showing "Require a pull request before merging").
    - Save as `evidence/change_management/branch_protection.png`.
2.  **Pull Request Example**:
    - Go to the **Pull Requests** tab > **Closed**.
    - Click on a recent merged PR.
    - Print the page to PDF (Ctrl+P) or take a full-page screenshot showing the reviewer's approval.
    - Save as `evidence/change_management/pr_sample_01.pdf`.

## 3. Release Labeling (Requirement 1.3)
**Control**: Releases are labeled for traceability.

**How we do it**:
- We use **Git Semantic Versioning** tags (e.g., `v1.0.1`).
- These are managed via the [VCS Repository Tags/Releases] page.

**Audit Evidence**:
- A screenshot of the "Tags" or "Releases" page in the repository.
- A list of recent commits showing the corresponding tags.

**How to Collect (GitHub)**:
1. Go to your repository **Code** tab.
2. Click on **Tags** (next to the branch selector).
3. Take a screenshot showing the list of version tags (e.g., `v1.0.0`).
4. Save as `evidence/releases/release_tags.png`.

---
*Note: This guide is for internal use to prepare for SOC 2 audits.*
