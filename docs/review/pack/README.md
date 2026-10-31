# CareerMetro expert review pack

Generated from `src/content` by `node scripts/review/build-review-pack.mjs`. Do not edit these files by hand in the repo; re-run the script after content changes.

## What we ask (about 5 minutes to read)

CareerMetro tells job seekers in India which skills a role needs and how to prove them. Each line below is one thing we say about a role or one test question. We need someone who works in that field to say whether it is right for India today.

1. Open the file for your field in Excel or Google Sheets.
2. Read each line. Fill in **one** of the last three columns:
   - **Agree (yes / no)**: write `yes` if the line is right as it is.
   - **Change to**: write what it should say instead (for a skill, you can also write `remove`, or change Required to Nice to have).
   - **Comment**: anything else, such as a missing skill or a duty that is rare in India.
3. Leave the first column (**Ref**) as it is. It is how we find the line again.
4. Add missing skills or duties as new lines at the end of a role: copy the role's name into **Role**, and write them in **Change to**.
5. Send the file back. Blank lines count as "not reviewed", never as "agree".

In the role files, **Section** says what the line is: the summary, "A normal day" (daily duties), the job titles it covers, the years of experience, or a skill. A skill is **Required**, **Nice to have**, or **one of** a group (the person needs any one of the listed skills). **Detail** says what a person in the role is expected to do with that skill; that sentence is the level we expect.

In the timed-test file, check that the marked answer is the only right one, the question is fair for the level (L1 is basic, L2 working, L3 expert), and the explanation is correct. In the Practice file, check the question and what a strong answer covers.

In the certifications file, **Proves** lists skills that holding the certificate shows on its own, and **Partial** skills it only touches. Put a skill in Proves only when the issuer's official exam outline names it. Until someone checks the outline, a skill proposed for Proves waits at the start of Partial; write it in **Change to** if the outline names it. **Roles** lists the roles that recommend it, as recommended or optional; say if it is wrong for a role, retired or renamed.

## Files

| Field | File | Roles awaiting review |
| --- | --- | --- |
| Cloud and infrastructure | `roles-cloud.csv` | 25 |
| Security | `roles-security.csv` | 25 |
| Data, analytics and AI | `roles-data.csv` | 21 |
| Enterprise apps (SAP, Oracle, Salesforce, ServiceNow and others) | `roles-enterprise-apps.csv` | 24 |
| Testing and quality | `roles-testing.csv` | 4 |
| Software, hardware, delivery and marketing | `roles-other.csv` | 59 |
| Sales, finance, HR and operations | `roles-business.csv` | 31 |

| Questions | File | Lines |
| --- | --- | --- |
| Timed test (multiple choice, hidden until reviewed) | `timed-test-questions.csv` | 54 |
| Practice bank (open questions) | `practice-questions.csv` | 135 |

| Certifications | File | Lines |
| --- | --- | --- |
| Certifications awaiting review (what each proves, and the roles that recommend it) | `certifications.csv` | 97 |

189 role profiles await review in all.

## How answers flow back into the app

1. Save the returned file in `/mnt/project-files/careermetro/review/returned/`, with the reviewer's name and the date in the file name.
2. Development runs `node scripts/review/read-review.mjs <returned file>`. It lists every line with an answer, grouped by role or question, and flags any Ref the current pack no longer holds (a removed role, skill, duty, question or certification, or one reviewed since).
3. Development makes the changes in `src/content` in one PR. For a role, it sets `reviewedBy` (the reviewer's name and field) and `updatedOn`; for a timed-test question or a certification, it sets `reviewed: true`. Practice questions have no review mark: a change is edited in place in `src/content/practice-questions.json`, and the Practice file keeps listing every question. The usual checks (the matcher and closest-role evals) run in CI.
4. The pack is generated again from the new content, so reviewed roles, timed-test questions and certifications drop out of it.

Reviewers' names go in the content only with their consent. Nothing in this pack comes from a user.
