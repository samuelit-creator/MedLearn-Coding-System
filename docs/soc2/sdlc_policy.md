# Software Development & Change Management Policy

## 1. Overview
This policy defines the standards for software development, version control, and change management at [Company Name]. It ensures that all changes to production systems are tracked, reviewed, and approved to maintain system security and integrity.

## 2. Version Control System (VCS)
The company uses **GitHub** (or [VCS Name]) as its central Version Control System to manage:
- Source code for all applications.
- Technical and security documentation.
- Infrastructure-as-Code (IaC) templates.
- Release labeling and versioning.

## 3. Access Control
Access to the VCS is strictly controlled:
- **Approval Required**: All new access requests or permission changes must be approved by the **System Admin** (e.g., CTO or DevOps Lead).
- **Least Privilege**: Users are granted the minimum level of access required for their role (e.g., Read, Write, Admin).
- **Authentication**: Multi-factor authentication (MFA) is mandatory for all VCS accounts.

## 4. Change Management Workflow
All code changes must follow the formal change management process:
1.  **Issue Tracking**: All changes must be linked to a ticket/issue (e.g., Jira, GitHub Issues) describing the purpose and scope.
2.  **Branching**: Development is performed on feature branches; direct commits to the main/production branch are prohibited.
3.  **Code Review**: At least one peer review is required for every Pull Request (PR) before merging.
4.  **Automatic Testing**: CI/CD pipelines must pass all automated tests before a PR can be merged.

## 5. Release Labeling
- Releases are formally labeled using **Git Tags** (e.g., `v1.2.3`).
- Each release tag must correspond to a stable commit that has passed all verification steps.
- Release notes must accompany every major production deployment.

## 6. Policy Enforcement
Failure to comply with this policy may result in disciplinary action. This policy is reviewed annually or upon significant changes to the development environment.
