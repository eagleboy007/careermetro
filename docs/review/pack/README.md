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
| Cloud and infrastructure | `roles-cloud.csv` | 31 |
| Security | `roles-security.csv` | 31 |
| Data, analytics and AI | `roles-data.csv` | 33 |
| Enterprise apps (SAP, Oracle, Salesforce, ServiceNow and others) | `roles-enterprise-apps.csv` | 41 |
| Testing and quality | `roles-testing.csv` | 5 |
| Software, hardware, delivery and marketing | `roles-other.csv` | 85 |
| Sales, finance, HR and operations | `roles-business.csv` | 51 |
| Core engineering (mechanical, electrical and civil) | `roles-core-engineering.csv` | 7 |
| Legal and compliance | `roles-legal.csv` | 4 |
| Healthcare administration (coding, billing, hospital operations and claims) | `roles-healthcare-admin.csv` | 4 |
| Hospitality (hotels, food and beverage) | `roles-hospitality.csv` | 4 |

| Questions | File | Lines |
| --- | --- | --- |
| Timed test (multiple choice, hidden until reviewed) | `timed-test-questions.csv` | 506 |
| Practice bank (open questions) | `practice-questions.csv` | 695 |

| Certifications | File | Lines |
| --- | --- | --- |
| Certifications awaiting review (what each proves, and the roles that recommend it) | `certifications.csv` | 104 |

| Levels | File | Lines |
| --- | --- | --- |
| The eight levels L1 to L8 and the job titles offered at sign-up (a title is a label and never sets the level; each role file also has a Level line) | `levels.csv` | 51 |

296 role profiles await review in all.

## Changed since the draft, awaiting sign-off

Development changed these lines after a test showed a problem. Their **Detail** ends with a note that begins "Changed since the draft". Please say yes, or what it should be.

- `export-import-executive#years`: Starts at 1 year (was 2): EXIM and export documentation executives are commonly hired at 0-2 years.
- `it-auditor#skill:domain-bfsi`: Nice to have (was Required): IT auditors work in every sector, not only banking and insurance.
- `salesforce-developer#skill:salesforce-clouds`: Required (was Nice to have): developers build on Sales or Service Cloud from day one.
- `salesforce-developer#skill:salesforce-security-model`: New Required skill: profiles, permission sets, sharing, and CRUD/FLS checks in code.
- `management-trainee#title`: Grouped with sales roles (drafted under operations): most campus management trainee programmes start in sales.
- `management-trainee#skill:financial-statement-analysis`: Nice to have (was Required): trainees learn it on the programme.
- `site-reliability-engineer#titles`: "Production Engineer" removed: in India it usually means a manufacturing role, now its own profile.
- `vlsi-design-engineer#titles`: "Design Verification Engineer", "ASIC Verification Engineer" and "Verification Engineer" removed: chip verification is now its own profile (Design Verification Engineer).
- `it-service-delivery-manager#title`: Grouped with infrastructure and cloud roles (drafted under delivery): its skills are IT operations ones (ITSM, major incidents, SLAs), shared with application support and technical account managers.
- `front-office-executive-hotel#skill:cross-selling-upselling`: Nice to have (was Required): none of the hotel front office posts the draft is built on ask for upselling.
- `corporate-legal-associate#skill:clm-platforms`: New Nice to have skill: in-house legal teams route, approve and store contracts in a contract management tool.
- `sap-security-grc-consultant#title`: Grouped with security roles (drafted under enterprise apps): its key skills are security ones (SAP authorizations, GRC Access Control, access audits), and the nearest roles for its resume are information security analyst and IT auditor.
- `fraud-analyst#skill:data-visualization`: Nice to have (was Required): none of the posts the draft cites asks for dashboards. As required, it made Fraud Analyst the closest role for data analyst and BPO quality resumes on SQL, Excel and dashboards alone.
- `trust-and-safety-analyst#skill:data-visualization`: Nice to have (was Required): only Google analyst posts seen through aggregators ask for dashboards. As required, it made Trust and Safety Analyst a Nearby line for every data analyst resume.
- `motor-control-engineer#skill:electrical-machines-transformers`: The live Electrical machines and transformers skill (drafted as a new skill, Traction and drive motors): the two overlap, so the live skill takes the draft's PMSM, BLDC and IPM motor phrases instead of a near duplicate.
- `actuarial-analyst#skill:sql`: Nice to have (was Required): one of the three posts the draft cites asks for SQL (Munich Re) and one lists it as preferred (WTW). As required, it made Actuarial Analyst a Nearby line for the e2e walk's data analyst resume (on SQL, Excel and Python) and for the data scientist switcher persona.
- `game-designer#title`: Grouped with delivery roles (drafted under frontend-mobile, next to game developer): it shares no programming skill with game developer, and its resume's nearest roles share A/B tests and spreadsheets, as product roles do.
- `marketing-automation-specialist#title`: Grouped with data and analytics roles (drafted under marketing): no live marketing role asks for its CRM, segmentation and SQL skills, so its resume's nearest roles are data scientist and analytics roles.
- `ev-powertrain-engineer#skill:electrical-machines-transformers`: The live Electrical machines and transformers skill (drafted as Traction and drive motors, electric-machines, which TG3 folded into the live skill): it already holds the PMSM, BLDC and IPM motor phrases.
- `ev-powertrain-engineer#skill:powertrain-dyno-testing`: Skill name shortened to Powertrain dyno and vehicle testing (drafted Powertrain dynamometer and vehicle testing, 83 characters): skill names show in fields capped at 80 characters.
- `head-of-ai#title`: Thin evidence, needs an expert's sign-off before it is trusted: no India employer post for Head of AI on the allowed sources, so the profile rests on global posts and Microsoft and AWS guidance. "Chief AI Officer" sits here because India has few such posts.
- `chief-risk-officer#title`: Thin evidence, needs an expert's sign-off before it is trusted: drafted from NABARD's CRO notice, the Basel principles and the RBI CRO rule, not employer posts. Credit risk modelling is required because most Indian CROs come from lending; an insurer's CRO would have it as nice to have.
- `cto#skill:it-vendor-management`: Required (was Nice to have): with people skills set aside, the draft had four skills a resume can be scored on, below the five every role keeps. CTOs in Indian companies own the large technology vendor contracts.
- `grc-manager#titles`: "IT Risk Manager" and "Cyber Risk Manager" removed: they are now the Cyber Risk Manager profile (batch TR1). "Head of GRC" removed: it is now Director of GRC (batch L7).
- `information-security-analyst#titles`: "IT Risk Analyst" and "Cyber Risk Analyst" removed: they are now the Cyber Risk Analyst profile (batch TR1).
- `director-information-security#title`: Director level (L7, batch L7), needs an expert's sign-off before it is trusted, like CISO, CRO and CTO. "Head of Information Security", "Head of Cyber Security" and "VP - Information Security" moved here from CISO, which keeps chief and deputy CISO titles.
- `head-of-risk#title`: Thin evidence, needs an expert's sign-off before it is trusted: no India employer post with this title on the allowed sources, so duties lean on the PNB CRO notice, RBI's CRO rule and NBFC risk committee rules. Credit-heavy because most Indian heads of risk sit in lending; for an insurer, credit risk modelling would be nice to have. "Head of Risk" and "Head - Risk Management" moved here from Chief Risk Officer. FRM is not in the certificate catalogue, so only CRISC is listed.
- `director-grc#title`: Director level (L7, batch L7), needs an expert's sign-off. "Head of GRC" moved here from GRC Manager.
- `director-of-engineering#title`: Director level (L7, batch L7), needs an expert's sign-off. "Head of Engineering" moved here from Engineering Manager and "VP of Engineering" from CTO. No certificate: posts ask for none.
- `director-data-ai#title`: Director level (L7, batch L7), needs an expert's sign-off. Takes data science leadership titles only; Head of AI keeps "Director of AI" and "AI Engineering Director".
- `director-cloud-infrastructure#title`: Director level (L7, batch L7), needs an expert's sign-off. Shares disaster recovery and strategy skills with Head of IT: this role leads cloud and platform teams, Head of IT the whole corporate IT function.
- `head-of-it#title`: Director level (L7, batch L7), needs an expert's sign-off. Rests on two employer posts (Dr. Reddy's, Zeta); mid-size company duties are inferred.
- `director-of-product#title`: Director level (L7, batch L7), needs an expert's sign-off before it is trusted.
- `ciso#titles`: "Head of Information Security", "Head of Cyber Security" and "VP - Information Security" removed: they are now Director of Information Security (batch L7).
- `chief-risk-officer#titles`: "Head of Risk" and "Head - Risk Management" removed: they are now Head of Risk (batch L7).
- `engineering-manager#titles`: "Head of Engineering" removed: it is now Director of Engineering (batch L7).
- `cto#titles`: "VP of Engineering" removed: it is now Director of Engineering (batch L7).

## How answers flow back into the app

1. Save the returned file in `/mnt/project-files/careermetro/review/returned/`, with the reviewer's name and the date in the file name.
2. Development runs `node scripts/review/read-review.mjs <returned file>`. It lists every line with an answer, grouped by role or question, and flags any Ref the current pack no longer holds (a removed role, skill, duty, question or certification, or one reviewed since).
3. Development makes the changes in `src/content` in one PR. For a role, it sets `reviewedBy` (the reviewer's name and field) and `updatedOn`; for a timed-test question or a certification, it sets `reviewed: true`. The first Practice questions have no review mark: a change is edited in place in `src/content/practice-questions.json`. Newer ones are drafts, hidden in production, with `reviewed: false` on the question and on its open twin in `src/content/mock-bank.json`; once checked, Development sets both to `true` (and `followUpsReviewed` once the follow-ups are checked). The Practice file keeps listing every question. The usual checks (the matcher and closest-role evals) run in CI.
4. The pack is generated again from the new content, so reviewed roles, timed-test questions and certifications drop out of it.

Reviewers' names go in the content only with their consent. Nothing in this pack comes from a user.
