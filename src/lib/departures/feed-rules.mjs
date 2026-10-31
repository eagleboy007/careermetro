// Plain-code rules for public job-board postings, shared by skill mining (scripts/jd-mining/mine.mjs) and the daily
// Departures feed (scripts/departures/fetch-feeds.mjs, docs/plans/departures-live-plan.md). Nothing here calls a
// model or the network: the live role comes from the title, the skills from the taxonomy's names and aliases, the
// place from the location fields, and the experience from the years the post states. No post text is kept; only
// what these functions return.
import { experienceBand, placesOf } from "../../../scripts/jd-mining/market.mjs";

/** @typedef {"greenhouse" | "lever" | "ashby" | "smartrecruiters"} Ats */
/** @typedef {"full_time" | "part_time" | "freelance"} FeedWorkType */
/** @typedef {{ id: string; name: RegExp; aliases: RegExp | null }} SkillMatcher */
/**
 * One posting as read from its board, before any rule: its id, title, link, location words, work type, first posted
 * time and its text as lines (headings included). The lines are read for skills and dropped.
 * @typedef {{ externalId: string; title: string; url: string; location: string; remote: boolean; workType: FeedWorkType;
 *   postedAt: Date | null; lines: string[] }} RawPost
 */

/** The feed's limits (plan, "Server checks and limits"). */
export const FEED_LIMITS = {
  boards: 300,
  postsPerBoard: 500,
  openPosts: 10000,
  /** One SmartRecruiters page, and the most pages read per board; India posts past them leave the board cut short. */
  smartRecruitersPage: 100,
  smartRecruitersPages: 20,
  timeoutMs: 15_000,
  /** The biggest board answer read. A large Greenhouse board with full descriptions is a few MB. */
  maxBytes: 25 * 1024 * 1024,
  /** Skill ids kept per list. */
  skills: 40,
  /**
   * The least time between two SmartRecruiters requests across the run, and the longest Retry-After waited on a 429:
   * SmartRecruiters publishes 10 requests a second and 8 at once; the feed stays near 6 a second and at most 4 at once.
   */
  smartRecruitersGapMs: 160,
  retryAfterMaxMs: 10_000,
  /** Runs in a row a board fails or keeps no India post before the run summary and /api/health name it. */
  badRuns: 3,
};

/** Names CareerMetro and where an employer reads how its board is used and asks for it to be removed (/terms#job-boards). */
export const USER_AGENT = "CareerMetroJobs/1.0 (+https://careermetro.vercel.app/terms#job-boards)";

/** @typedef {"eu"} BoardHost A Greenhouse board on its EU host; every other board is on the default host. */

/**
 * The one public GET per board. A Greenhouse board with `host: "eu"` is read from Greenhouse's EU host. SmartRecruiters
 * answers a page at a time, asked for India posts only; `offset` reads a later page.
 */
export function feedUrl(/** @type {Ats} */ ats, /** @type {string} */ token, /** @type {BoardHost | undefined} */ host = undefined, offset = 0) {
  const t = encodeURIComponent(token);
  if (ats === "greenhouse") return `https://boards-api${host === "eu" ? ".eu" : ""}.greenhouse.io/v1/boards/${t}/jobs?content=true`;
  if (ats === "lever") return `https://api.lever.co/v0/postings/${t}?mode=json`;
  if (ats === "ashby") return `https://api.ashbyhq.com/posting-api/job-board/${t}`;
  return `https://api.smartrecruiters.com/v1/companies/${t}/postings?country=in&limit=${FEED_LIMITS.smartRecruitersPage}${offset ? `&offset=${offset}` : ""}`;
}

/** The company's careers page on its job board, as job-boards.json lists it. */
export function careersUrlOf(/** @type {Ats} */ ats, /** @type {string} */ token, /** @type {BoardHost | undefined} */ host = undefined) {
  const t = encodeURIComponent(token);
  if (ats === "greenhouse") return `https://job-boards${host === "eu" ? ".eu" : ""}.greenhouse.io/${t}`;
  if (ats === "lever") return `https://jobs.lever.co/${t}`;
  if (ats === "ashby") return `https://jobs.ashbyhq.com/${t}`;
  return `https://jobs.smartrecruiters.com/${t}`;
}

/* The live role, from the title (moved from mine.mjs) ------------------------------------------------------------ */

const NOT_IN_SCOPE = /\b(counsel|attorney|legal|paralegal|sales|account executive|recruit(er|ing)|partner manager)\b/i;
// "Member of Technical Staff" is a plain engineering title, not a staff-level one.
const SENIOR = /\b(director|head of|vice president|vp|principal|(?<!technical )staff|chief|intern|internship)\b/i;
// The principal, staff and head-of titles that a senior role is built for, so they read as it rather than being dropped.
const SENIOR_TITLES = /\b(principal|staff) (data architect|database engineer|back[- ]?end (engineer|developer)|front[- ]?end (engineer|developer)|data scientist|technical program(me)? manager)\b|\bhead of (engineering|grc|security operations|soc)\b|\bdirector of engineering\b|\bengineering director\b/i;
// Order matters: the first matching role wins, so a narrower role comes before the broader one that would also match
// ("Cloud security engineer" before security, "SRE" and "Cloud engineer" before DevOps, "React Native" before front end).
export const ROLE_TITLES = {
  // A pre-sales engineer or consultant title before the security, network and cloud rules that would read the rest of
  // it ("Cyber Security Presales Engineer"); a pre-sales architect stays a solutions architect, and a plain "Sales
  // Engineer" stays out of scope.
  "presales-engineer": /\bpre-?sales( (solutions?|technical|cloud))? (engineer|consultant|specialist|lead)\b|\b(technical|cloud) pre-?sales\b|^(?!.*\bsupport\b)((senior|sr\.?|associate|lead) )?solutions? engineer\b/i,
  // A developer relations title before the language, cloud and security rules that would read the rest of it ("Cloud
  // Developer Advocate", "Python Developer Advocate"); a "Developer Relations Manager" has no rule.
  "developer-advocate": /\b(developer|dev) (advocate|evangelist)\b|\bdeveloper relations( (engineer|advocate|lead|specialist))?\b|\bdevrel\b|\btechnical evangelist\b/i,
  // A forward deployed or customer-embedded engineer title before the AI, embedded and software rules that would read
  // the rest of it ("Forward Deployed AI Engineer", "Customer-Embedded Software Engineer").
  "forward-deployed-engineer": /\bforward[- ]deployed\b.*\b(engineer|developer|engineering)\b|\bcustomer[- ]embedded (software )?engineer\b|\bai deployment engineer\b/i,
  // A malware title before the threat intelligence and broad security rules ("Threat Researcher - Malware"); a plain
  // "Reverse Engineer" can be a mechanical one, so it counts only beside security or binary.
  "malware-analyst": /^(?=.*\b(analyst|engineer|researcher|specialist|consultant)\b)(.*\bmalware\b|.*\b(security|binary) reverse engineer(ing)?\b)/i,
  // An architect title before the analyst and engineer rules that would also read "security" in it ("Cloud Security Architect").
  "security-architect": /\b(security|cyber ?security|infosec|zero trust) (solutions? )?architect\b|\barchitect,? (information |cyber ?)?security\b/i,
  "cloud-security-engineer": /\b(cloud security|security engineer,? cloud|(aws|azure|gcp|google cloud) security (engineer|analyst|specialist)|cspm (engineer|analyst|specialist))\b/i,
  "grc-manager": /\b(grc|governance,? risk|risk and compliance|security governance|it risk|cyber ?risk|isms|(information )?security compliance)\b.*\b(manager|lead)\b|\bhead of grc\b/i,
  // A storage or backup title before the privacy rule, which would read "Data Protection Engineer"; never a storage
  // software developer or a database one.
  "storage-backup-engineer": /^(?!.*\b(software|developer|database|dba)\b).*(\b(storage|backup|san|nas|data protection)( (and|&) (backup|recovery|storage))? (engineer|administrator|admin|specialist|consultant)\b|\b(netapp|commvault|veeam|netbackup|isilon|powerscale)\b.*\b(engineer|administrator|admin|specialist|consultant)\b)/i,
  "privacy-analyst": /\b(privacy|data protection|dpdp|gdpr)\b.*\b(analyst|specialist|associate|engineer|consultant)\b/i,
  // A plant or control-system security title before the broad security rules.
  "ot-security-engineer": /\b(ot\/ics|ot|ics|scada|operational technology) (cyber ?security|security)\b|\bindustrial cyber ?security\b/i,
  // Security built into pipelines, before the security and DevOps rules that would read either half of it.
  "devsecops-engineer": /\bdevsecops\b|\b(security platform|ci\/cd security|pipeline security) engineer\b/i,
  // A privileged access title before the IAM rule ("CyberArk Engineer", "PAM Engineer").
  "pam-engineer": /^(?=.*\b(engineer|analyst|developer|specialist|consultant|administrator|admin)\b).*\b(pam|privileged (access|account|identity)( management)?|cyberark|beyondtrust|delinea|thycotic)\b/i,
  // A DLP or information protection title before the privacy, storage and broad security rules; a plain "Data Security
  // Engineer" stays a security one, and a Purview data governance or catalogue title is not one.
  "dlp-engineer": /^(?!.*\b(governance|catalog|catalogue)\b).*\b(dlp|data loss prevention|information protection|(microsoft )?purview)\b.*\b(engineer|analyst|specialist|consultant|administrator|admin)\b/i,
  "iam-engineer": /^(?=.*\b(engineer|analyst|developer|specialist|consultant|administrator|admin)\b).*\b(iam|idam|identity (and |& )?access( management)?|identity (governance|management|security)|access management|sailpoint|saviynt|okta|ping ?identity)\b/i,
  // A vendor or third-party risk title before the information security rule; a procurement "Supplier Risk" one is not one.
  "third-party-risk-analyst": /^(?=.*\b(analyst|specialist|associate|assessor|consultant|lead|officer)\b).*\b(third[- ]party (risk|security)|tprm|vendor (risk|security))\b/i,
  // An IT or information systems audit title before the information security rule ("IT Audit Analyst"); never a
  // financial, tax, quality or safety audit one.
  "it-auditor": /^(?!.*\b(financial|finance|tax|statutory|clinical|quality|safety|energy)\b).*\b(it|is|information systems|technology|information security|cyber ?security|itgc)( risk (and|&))? audit(or|ing)?\b/i,
  "information-security-analyst": /\b(information security|infosec|grc|governance,? risk|security (compliance|governance|risk)|it risk|cyber ?risk|risk and compliance|it audit|isms|it compliance|third[- ]party risk)\b/i,
  // A red team or adversary emulation title before the penetration testing rule; "Red Team Analyst" stays there.
  "red-team-operator": /^(?!.*\banalyst\b).*\b(red team(er|ing)?|adversary (emulation|simulation)|offensive security operator)\b/i,
  "penetration-tester": /\b(penetration test(er|ing)?|pen ?test(er|ing)?|offensive security|red team|ethical hack(er|ing)|security tester|vulnerability assessment (analyst|engineer|specialist))\b/i,
  // After the penetration testing rule, so a "VAPT" pen tester title stays there.
  "vulnerability-management-analyst": /\b(vulnerability (management|analyst|engineer|specialist)|vapt analyst|qualys (analyst|engineer)|cyber hygiene)\b/i,
  "appsec-engineer": /\b(appsec|application security|product security|software security (engineer|analyst)|secure code review(er)?)\b|\bsoftware (engineer|developer)\b.*\bsecurity\b/i,
  "soc-lead": /\b(soc( shift)?|security operations( cent(er|re))?|cyber defen[cs]e|detection (and|&) response) (lead|manager)\b|\b(lead|manager),? soc\b|\bhead of (security operations|soc)\b|\bsoc (l3|level 3|tier 3)( analyst)?\b/i,
  // Detection and hunting titles are L2 work, before the broad security rule that would read "threat" in them.
  "soc-analyst-l2": /\b(soc|security) analyst,? (l2|ii|2|level ?2)\b|\bl2 soc\b|\b(senior|sr\.?) soc analyst\b|\b(security operations|cyber defen[cs]e|siem) analyst\b|\bdetection engineer\b|\bthreat hunter\b/i,
  // A SIEM platform or content title after the L2 rule, which keeps "SIEM Analyst"; never an analyst one.
  "siem-engineer": /^(?!.*\banalyst\b)(?=.*\b(engineer|developer|administrator|admin|consultant|specialist)\b).*\b(siem|splunk|qradar|(microsoft |azure )?sentinel|arcsight|logrhythm|securonix|exabeam|security content)\b/i,
  "threat-intelligence-analyst": /^(?=.*\b(analyst|engineer|specialist|researcher|consultant)\b).*\b(threat intel(ligence)?|cti|threat research|dark web)\b/i,
  // A forensic analyst or examiner title before the incident response rule, which keeps investigator and DFIR titles;
  // never a fraud, accounting or audit one.
  "digital-forensics-analyst": /^(?!.*\b(financial|finance|fraud|accounting|accountant|audit|auditor|dfir|investigator)\b).*\b((digital|cyber|computer|mobile) )?forensics? (analyst|examiner|specialist|consultant|technology analyst|engineer)\b/i,
  "incident-response-analyst": /\b(incident respon(se|der)s?|incident handl(er|ing)|dfir|((digital|cyber|computer) )?forensics? investigator|(csirt|cert) (analyst|engineer))\b/i,
  // A network operations centre title before the network rules; "Network Operations Engineer" stays a network one.
  "noc-engineer": /\b(noc|network operations cent(er|re)|network monitoring) (engineer|analyst|specialist|technician|support engineer|executive|associate)\b|\b(l[123]|level ?[123]) noc\b/i,
  // A contact center platform (CCaaS, IVR) title before the calling and cloud rules ("Genesys Cloud Developer"); never a
  // test, support or agent one, nor a plain on-premises telephony one.
  "contact-center-developer": /^(?!.*\b(test|tester|testing|qa|support|agent|executive|associate)\b)(?=.*\b(developer|engineer|programmer|consultant)\b).*\b(contact cent(er|re)|amazon connect|aws connect|(nice )?cxone|(nice )?incontact|genesys( cloud| purecloud| engage)?|ivr|ccaas)\b/i,
  // A calling or collaboration platform title; never a voice AI or speech one, nor an Office 365 collaboration admin.
  "unified-communications-engineer": /\b(unified communications?|uc|voip|voice|telephony|ip telephony|cisco (voice|collaboration|uc)|(microsoft )?teams (voice|phone)|cucm|webex)( and video)? (engineer|administrator|admin|specialist|consultant)\b|\bcollaboration engineer\b/i,
  // A radio network title before the performance test and test rules ("RF Performance Engineer", "Drive Test Engineer");
  // never an RF hardware, antenna or RAN software one.
  "telecom-ran-engineer": /^(?!.*\b(design|hardware|pcb|antenna|circuit|ic|silicon|asic|software|developer)\b).*(\b((lte|4g|5g)( nr)? )?ran( (optimi[sz]ation|performance|integration|kpi))? (engineer|analyst|specialist|consultant)\b|\b(rf|radio|ran)( network)? (optimi[sz]ation|performance|planning( (and|&) optimi[sz]ation)?) (engineer|analyst|specialist|consultant)\b|\b(lte|4g|5g)( nr)? rf engineer\b|\bdrive test(ing)? (engineer|analyst|specialist)\b)/i,
  // A Microsoft 365, Exchange or SharePoint admin title after the calling rule, which keeps "Teams Voice Engineer".
  "m365-administrator": /\b(microsoft 365|m365|office ?365|o365)( collaboration| messaging| workplace)?( support)? (engineer|administrator|admin|specialist|consultant|analyst)\b|\b(exchange( online| server)?|messaging|collaboration|sharepoint( online)?|microsoft teams) (administrator|admin)\b|\bexchange( online| server)? engineer\b/i,
  // A firewall, NAC or secure-access title before the broad security and network rules that would read either half of it.
  "network-security-engineer": /\b(network security|firewall|palo alto( firewall)?|fortinet|fortigate|check ?point( firewall)?|zscaler|nac|cisco ise|sase|ztna) (engineer|administrator|admin|specialist|consultant)\b/i,
  "cyber-security-analyst": /\b(security (analyst|engineer|operations|specialist)|soc analyst|cyber ?security|threat|blue team)\b/i,
  // A cloud network title before the network rule ("Azure Network Engineer"); a cloud network security one stays above.
  "cloud-network-engineer": /\b(cloud|aws|azure|gcp|google cloud|hybrid cloud|multi-?cloud) network(ing)? (engineer|specialist|consultant|architect|lead|administrator|admin)\b/i,
  "network-engineer": /\b(network (automation |operations |support |infrastructure |implementation )?(engineer|administrator|admin|specialist|consultant|analyst)|(routing (and|&) switching|lan|wan|sd-?wan) (engineer|specialist))\b/i,
  // A Salesforce admin title before the system administrator rule ("Salesforce System Administrator").
  "salesforce-administrator": /^(?=.*\b(salesforce|sfdc)\b).*\b(admin|administrator)\b/i,
  // A ServiceNow admin or platform analyst title before the system administrator rule ("ServiceNow System
  // Administrator"); a developer, engineer or architect one stays a ServiceNow developer (below).
  "servicenow-administrator": /^(?!.*\b(developer|engineer|architect|business analyst|test|tester|testing|qa)\b).*\bservicenow\b.*\b(administrator|admin|(platform|support|itsm|system) analyst)\b/i,
  // An SAP Basis or HANA administration title before the DBA and system administrator rules ("SAP HANA DBA"); "Basis"
  // counts only beside "SAP".
  "sap-basis-administrator": /^(?=.*\bsap\b).*\b(basis|netweaver (administrator|admin)|hana (dba|database administrator|administrator|admin))\b/i,
  // A Workday title before the data analyst and integration rules ("Workday Reporting Analyst", "Workday Integration
  // Developer"); never a test one.
  "workday-consultant": /^(?!.*\b(test|tester|testing|qa)\b)(?=.*\b(consultant|developer|engineer|analyst|specialist|lead|architect|administrator|admin)\b).*\bworkday\b/i,
  // A SuccessFactors title before the business analyst rule, which would read "Functional Consultant" when "SAP" is
  // missing; never a developer, ABAP or test one.
  "sap-successfactors-consultant": /^(?!.*\b(test|tester|testing|qa|abap|developer)\b)(?=.*\b(consultant|analyst|lead|specialist|architect|administrator|admin)\b).*\b(successfactors|sap sf|sf ec)\b/i,
  // A virtual desktop, endpoint or packaging title before the virtualization, system administrator and IT support rules;
  // a plain "EUC Analyst" or "EUC Technician" stays IT support, and a Citrix NetScaler (ADC) title is not one.
  "euc-engineer": /^(?!.*\b(netscaler|adc)\b).*\b(end user computing( \(euc\))?|euc|vdi|citrix|xenapp|xendesktop|avd|azure virtual desktop|(vmware|omnissa) horizon|intune|sccm|mecm|configmgr|endpoint management|desktop engineering|workspace one|(application|app|msi) packaging) (engineer|administrator|admin|specialist|consultant|lead)\b/i,
  // A server virtualization title before the system administrator rule ("VMware Engineer"); "VMware Support Engineer"
  // and "VMware Systems Administrator" stay there.
  "virtualization-engineer": /\b(virtuali[sz]ation|vmware( vsphere| esxi| vcenter)?|vsphere|esxi|hyper-?v|nutanix|hci|hyper-?converged( infrastructure)?) (engineer|administrator|admin|specialist|consultant|lead)\b/i,
  // A data centre floor title before the system administrator and DevOps rules ("Data Center Infrastructure Engineer");
  // never a facility (power, cooling), design, network or security one.
  "data-center-engineer": /^(?!.*\b(software|developer|design|architect|electrical|mechanical|hvac|facility|facilities|construction|network|security)\b).*(\b(data ?cent(er|re)|colocation)( (operations|ops|hardware|infrastructure|infra|services|support))? (engineer|technician|specialist|associate|executive|administrator|admin)\b|\b(dc|colo) (operations|ops) (engineer|technician|specialist|associate|executive)\b|\bremote hands (engineer|technician|specialist)\b)/i,
  // An application server or middleware administration title (tech batch TG1), before the system administrator rule;
  // never a developer, test or message broker one. "Middleware Developer" stays an integration one.
  "middleware-administrator": /^(?!.*\b(developer|programmer|test|tester|testing|qa|message broker|iib|ace)\b)(.*\b(weblogic|websphere|jboss|wildfly|tomcat|fusion middleware)\b.*\b(administrator|admin|engineer|specialist|consultant)\b|.*\bmiddleware (administrator|admin|administration|engineer|support engineer|specialist)\b|.*\bapplication server (administrator|admin|engineer)\b)/i,
  "system-administrator": /\b(sys ?admin|systems? (administrator|admin)|(it )?server (administrator|admin)|it administrator|infrastructure support engineer|(linux|unix|windows|wintel|vmware|active directory)( server| system| systems)? (administrator|admin|engineer|support engineer))\b/i,
  // A customer service or contact centre title before the IT service desk rule ("Customer Service Desk Agent"); never a
  // support engineer, and "Customer Support Associate" stays product support (below).
  "customer-support-executive": /^((senior|sr\.?|junior|jr\.?) )?((customer (service|care)|contact cent(re|er)|call cent(re|er)|phone banking)( desk)? (executive|associate|representative|agent|officer|advisor|adviser)|(customer|chat|voice|email) support (executive|representative|agent|officer|advisor|adviser))\b/i,
  // A customer, HR, travel or other business desk ("Customer Service Desk Agent", "HR Helpdesk Executive") is not IT
  // support unless the title says IT (T152); a plain "Service Desk Agent" stays IT support.
  "it-support-engineer": /^(?!(?!.*\bit\b).*\b(customer|consumer|hr|human resources?|payroll|travel|voice|guest|patient|bpo|call cent(er|re)|contact cent(er|re))\b).*\b(desktop support|deskside support|service desk|help ?desk|end user computing( \(euc\))?|euc|it support|field support) (engineer|specialist|analyst|associate|executive|technician|agent)\b/i,
  // A cloud support title before the product support one that would read "Technical Support Engineer" in it.
  "cloud-support-engineer": /\b(cloud|aws|azure|gcp|google cloud)( technical)? support (engineer|associate|specialist|analyst)\b|\bcloud support\b/i,
  // An application or production support title before the product support one.
  "application-support-engineer": /\b(application|app|production|prod) (production )?support (engineer|analyst|specialist|associate|executive|lead)\b/i,
  // A technical account or technical customer success title; a plain "Customer Success Manager" is customer success
  // (below), and a plain "Account Manager" has no rule.
  "technical-account-manager": /\b(technical|cloud) account manager\b|\btechnical customer success manager\b|\bcustomer success manager\b.*\btechnical\b/i,
  // A customer success title after the TAM rule, which keeps "Technical Customer Success Manager"; "Customer Success
  // Engineer" stays product support, and an edtech "Customer Success Executive" or "Associate" is not one.
  "customer-success-manager": /\b(customer|client|ai|saas) success (manager|lead|specialist|partner)\b|\bcustomer success account manager\b/i,
  // A product support title; "Database Support Engineer" stays a DBA one.
  "technical-support-engineer": /\b(technical|tech|product|customer|saas|l[123]) support (engineer|specialist|associate|analyst)\b|\bcustomer success engineer\b|^((senior|sr\.?|associate|lead) )?(support|escalation) engineer\b/i,
  "database-administrator": /\b(database (administrator|admin|support engineer)|dba|(sql server|oracle|mysql|postgres(ql)?|mongodb|db2) (database administrator|administrator|admin))\b/i,
  // A governance or data quality title before the data, analyst and test rules that would read "Data" or "Quality" in it.
  "data-governance-analyst": /\bdata steward\b|\b(data governance|data quality|metadata|data catalog|collibra)\b.*\b(analyst|specialist|associate|consultant)\b/i,
  // A data testing or data quality engineering title after the governance rule, which keeps "Data Quality Analyst",
  // and before the test and SRE rules ("ETL Test Engineer", "Data Observability Engineer").
  "data-quality-engineer": /\b(data (quality|qa|test(ing)?|validation|observability)|(etl|dwh|data warehouse|big data) (test(ing)?|qa))( automation)? (engineer|tester)\b|\betl tester\b/i,
  // A data architect designs the whole data platform; a database architect stays with database design.
  "data-architect": /\b(data|data platform|lakehouse) architect\b/i,
  // A core banking platform title (tech batch TG1), before the Oracle and business analyst rules ("Oracle FLEXCUBE
  // Technical Consultant", "Finacle Functional Consultant"); never a test one.
  "core-banking-consultant": /^(?!.*\b(test|tester|testing|qa)\b)(.*\b(finacle|t24|temenos|flexcube|core banking)\b.*\b(consultant|developer|engineer|specialist|lead|architect|expert|business analyst)\b|.*\bcbs (functional|technical|techno-?functional) consultant\b)/i,
  // An Oracle Fusion or Integration Cloud technical title, never a functional, DBA or Oracle Cloud Infrastructure one.
  "oracle-fusion-technical-consultant": /^(?!.*\b(functional|dba|database administrator|infrastructure)\b)(?=.*\b(technical|developer|engineer|consultant|analyst)\b).*\b(oracle (fusion|cloud (erp|hcm|scm|financials|technical)|integration cloud|oic|hcm cloud|erp cloud)|oic)\b/i,
  // An Oracle EBS (Oracle Apps, R12) technical or techno-functional title after the Fusion rule; never a DBA, test or
  // plain functional one (those stay with the DBA and business analyst rules).
  "oracle-ebs-consultant": /^(?!.*\b(dba|database administrator|fusion|cloud|test|tester|testing|qa)\b)(?!.*(?<!techno-)\bfunctional\b)(?=.*\b(consultant|developer|engineer|analyst|programmer|lead)\b).*\b(oracle (ebs|e-business suite|apps|applications|r12|11i)|ebs r12)\b/i,
  "database-architect": /\b(database (design )?(architect|engineer)|database reliability|data modeler)\b/i,
  // Data annotation and AI training data titles (tech batch TG1), before the computer vision, ML and data analyst rules
  // ("AI Training Data Analyst"); never a software, test, genome or packaging label one.
  "data-annotation-specialist": /^(?!.*\b(software|developer|test|tester|testing|qa|genome|genomic|bioinformatics|clinical|packaging|regulatory)\b)(.*\b(data |image |video |text |audio )?annotat(or|ors|ion)\b|.*\bdata label(l)?(er|ers|ing)\b|.*\bai (training data|data trainer|trainer)\b|.*\btraining data (analyst|specialist|associate)\b|.*\b(generative ai|genai|ml) data (analyst|associate)\b)/i,
  // Before the data, AI and machine learning rules, which would read "Video Analytics Engineer" or "Vision AI Engineer".
  "computer-vision-engineer": /^(?=.*\b(engineer|developer)\b).*\b(computer vision|cv|vision ai|image processing|machine vision|video analytics|perception)\b/i,
  // Automotive functional safety titles (tech batch TG1), before the ADAS, AUTOSAR, embedded, hardware and software rules
  // ("Software Functional Safety Engineer"); a plain "Safety Engineer" (often plant or site safety) has no rule.
  "functional-safety-engineer": /\b(functional safety|fusa|iso ?26262)\b.*\b(engineer|specialist|consultant|lead|analyst|architect|expert)\b|\bsafety engineer\b.*\bautomotive\b|\bautomotive\b.*\bsafety engineer\b/i,
  // Car infotainment and Android Automotive titles (tech batch TG1), before the Android, embedded and software rules;
  // never a test or validation one.
  "infotainment-engineer": /^(?!.*\b(test|tester|testing|qa|validation)\b)(?=.*\b(engineer|developer|programmer|architect|lead|specialist)\b)(.*\b(infotainment|ivi|aaos|android automotive|digital cockpit)\b|.*\b(android|qt|qml|hmi)\b.*\bautomotive\b|.*\bautomotive\b.*\b(android|qt|qml|hmi)\b)/i,
  // A hardware-in-the-loop or ECU validation title before the test, C++ and embedded rules ("HIL Test Engineer", "C++
  // Experts for ADAS HIL Framework Development"); it is not a test role, so a hardware word never blocks it.
  "hil-test-engineer": /^(?=.*\b(engineer|developer|development|tester|specialist|experts?|lead)\b).*(\b(hil|hil\/sil|sil\/hil|hardware[- ]in[- ](the[- ])?loop|dspace|veristand)\b|\becu (validation|test(ing)?)\b)/i,
  // An ADAS title after the computer vision rule, which keeps perception titles, and after the HIL rule.
  "adas-engineer": /^(?=.*\b(engineer|engineering|developer|specialist|lead)\b).*\b(adas|advanced driver[- ]assistance( systems?)?|driver[- ]assistance)\b/i,
  // A whole-vehicle diagnostic or troubleshooting title; never a UDS stack, software or developer one.
  "automotive-diagnostics-engineer": /^(?!.*\b(software|developer|uds|stack|autosar)\b)(?=.*\b(engineer|specialist|expert|lead)\b).*\b(automotive|vehicle|ev|hev|aftermarket)( \(?systems?\)?)? (diagnostics?|troubleshooting)\b/i,
  // Clinical and statistical programmers (tech batch TG1), before the data rules; a plain "SAS Programmer" (often in
  // banking analytics) has no rule.
  "clinical-sas-programmer": /\b(clinical|statistical|biostatistical|clinical trials?) (sas )?programm(er|ing analyst|ing lead)\b|\bclinical programmer\b|\bclinical sas\b|\bsas (clinical|statistical) programmer\b|\b(sdtm|adam|cdisc)\b.*\b(programmer|developer|specialist)\b/i,
  // A dbt or analytics engineering title before the ETL and data engineering rules.
  "analytics-engineer": /(?<!\btext )\banalytics engineer(ing)?\b|\bdbt (developer|engineer)\b|\bdata modell?ing engineer\b/i,
  // A Kafka, Flink or streaming data title before the ETL, data and platform rules ("Streaming Data Engineer",
  // "Streaming Platform Engineer"); never a video or media streaming one.
  "kafka-streaming-engineer": /^(?!.*\b(test|tester|testing|qa|video|media|audio|ott|live)\b)(?=.*\b(engineer|developer|programmer|specialist|consultant|administrator|admin)\b).*\b(kafka|confluent|flink|(event|data) streaming|streaming (data|platform|pipelines?)|real[- ]?time data|stream processing)\b/i,
  // An ETL tool title before the data engineering rule; never a test one.
  "etl-developer": /^(?!.*\b(test|tester|testing|qa)\b).*\b(etl|informatica|ssis|talend|iics|datastage|data warehouse|dwh)\b.*\b(developer|engineer|consultant)\b/i,
  // A PL/SQL or T-SQL programmer; "Oracle DBA" stays a DBA title (above).
  "database-developer": /\b((oracle )?pl\/?sql|t-?sql|oracle|sql( server)?|database|db) (developer|programmer)\b/i,
  "data-engineer": /\b(data engineer|big data engineer|data platform engineer|data (pipeline|integration) engineer|pyspark (developer|engineer)|databricks (engineer|developer))\b|\bsoftware (engineer|developer)\b.*\bdata\b/i,
  // An AI, ML, NLP, vision or applied research scientist title before the NLP and data science rules; a plain or
  // "Associate Research Scientist" has no rule (lab and pharma boards use it), and "Applied Scientist" stays data science.
  "ai-research-scientist": /^(?!.*\b(chemistry|chemical|biology|biological|pharma|pharmaceutical|clinical|formulation|analytical|hplc|materials?|food|polymer)\b).*(\b((ai|ml|machine learning|deep learning|nlp|computer vision|vision|applied|llm|gen(erative)?[- ]?ai) research scientist|ai scientist)\b|\bresearch scientist\b.*\b(ai|ml|machine learning|deep learning|nlp|natural language processing|computer vision|vision|llm|gen(erative)?[- ]?ai|applied)\b)/i,
  // An NLP title before the AI, machine learning and data science rules; "Machine Learning Engineer - NLP" stays ML.
  "nlp-engineer": /\b(nlp|natural language processing|text analytics)( data)? (engineer|scientist|developer|researcher)\b|\bcomputational linguist\b/i,
  "mlops-engineer": /\b(ml[- ]?ops|llm[- ]?ops|machine learning operations|ml devops|model ?ops)\b.*\b(engineer|developer|specialist)\b|\b(ml|machine learning|ai) (platform|infrastructure|infra) engineer\b|\bsoftware (engineer|developer)\b.*\b(ml[- ]?ops|llm[- ]?ops)\b/i,
  // A generative AI title; "AI/ML Engineer" and "ML/AI Engineer" stay machine learning ones.
  "ai-engineer": /(?<![\w/])(gen(erative)?[- ]?ai|llm|agentic ai|ai agents?|prompt|conversational ai|applied ai|ai application|ai) (engineer|developer)\b|\bsoftware (engineer|developer)\b.*\b(gen(erative)?[- ]?ai|llm|agentic)\b/i,
  "ml-engineer": /\b(machine learning|ml|ai|deep learning) engineer\b|\b(machine learning|ml) developer\b|\bsoftware (engineer|developer)\b.*\b(machine learning|ml|ai)\b/i,
  // An HPC, GPU or CUDA title after the ML rules and before the performance test and DevOps rules ("GPU Performance
  // Engineer", "HPC Infrastructure Engineer"); never a chip design, verification or hardware one.
  "hpc-gpu-engineer": /^(?!.*\b(test|tester|testing|qa|design|verification|validation|rtl|asic|physical|dft|silicon|hardware)\b)(?=.*\b(engineer|developer|programmer|specialist|administrator|admin)\b).*\b(hpc|high[- ]performance computing|gpu|cuda|supercomput(er|ing))\b/i,
  // A search or search relevance title after the ML rules and before the platform, Java and software rules ("Software
  // Engineer - Search"); never an SEO or marketing one.
  "search-engineer": /^(?!.*\b(test|tester|testing|qa|seo|sem|marketing|optimi[sz]ation|executive)\b)(?=.*\b(engineer|developer|programmer)\b).*\b(search|elasticsearch|opensearch|solr|lucene|vespa)\b/i,
  // A BI developer builds the reports; a "BI Analyst" stays a data analyst.
  "bi-developer": /\b(bi|power ?bi|msbi|business intelligence|tableau|qlik( ?sense| ?view)?|looker|ssrs|reporting|dashboard) (developer|engineer|consultant|specialist)\b/i,
  // A cloud cost title or a plain "FinOps" one; a plain "Financial Analyst" has no rule.
  "cloud-finops-analyst": /\bfinops\b|\bcloud (cost|financial|finance|billing)( optimi[sz]ation| management)? (analyst|engineer|specialist|consultant|lead)\b/i,
  "data-analyst": /\b(data|analytics|bi|business intelligence|product|insights|reporting|mis) analyst\b|\banalytics associate\b/i,
  "business-analyst": /\bbusiness (systems )?analyst\b|^(?!.*\bsap\b).*\b(functional|techno-?functional|requirements) (analyst|consultant)\b/i,
  // Before the manual and automation test rules, which would read "QA" or "Test" in it.
  "performance-test-engineer": /^(?!.*\bmarket).*\b(performance|load|stress|non-functional|nft)\b.*\b(test(er|ing)?|engineer|consultant)\b/i,
  // A test lead title before the manual and automation test rules.
  "qa-lead": /\b(qa|test|testing|quality assurance|sdet)( automation| test)? (team )?lead\b|\b(automation test|qa automation) lead\b|\blead (qa|sdet|test|quality assurance)\b/i,
  // A manual testing title, never an automation one, before the mobile and front-end rules ("Mobile Manual Tester").
  // A plain "QA Analyst", "Quality Analyst" or "Test Engineer" is manual testing; "QA Engineer" stays automation.
  "manual-test-engineer": /^(?!.*\b(automation|sdet|selenium)\b).*(\bmanual\b.*\b(test(er|ers|ing)?|qa|quality)\b|\b(test(er|ing)?|qa|quality)\b.*\bmanual\b|\b(software|functional|manual|qa) tester\b|^((senior|sr\.?|junior|jr\.?|associate|trainee) )?((qa|quality) analyst|test engineer)\b)/i,
  // An RPA title, or a plain "Automation Developer", never a test automation one.
  "rpa-developer": /^(?!.*\b(test|tester|testing|qa|sdet)\b)(.*\b(rpa|robotic process automation|robotics process automation|uipath|ui path|automation anywhere|blue prism|power automate desktop|intelligent automation|hyperautomation)\b.*\b(developer|engineer|analyst|consultant|architect|lead)\b|^((senior|sr\.?|junior|jr\.?) )?automation developer$)/i,
  // A commerce platform title before the Salesforce, PHP and front-end rules ("Salesforce Commerce Cloud Developer");
  // a plain e-commerce title only as a developer one, and a WooCommerce one stays PHP.
  "ecommerce-developer": /^(?!.*\b(test|tester|testing|qa)\b).*(\b(shopify( plus)?|magento( 2)?|adobe commerce|sfcc|salesforce (b2c )?commerce( cloud)?|b2c commerce|demandware|bigcommerce)\b.*\b(developer|engineer|programmer)\b|\be-?commerce (web |front[- ]?end )?developer\b)/i,
  // Platform developer titles before the front-end and back-end rules that would read "Lightning" or "Backend" in them.
  "salesforce-developer": /\b(salesforce|sfdc)\b.*\b(developer|engineer|technical consultant)\b|\b(apex|salesforce lightning) developer\b/i,
  "servicenow-developer": /\bservicenow\b.*\b(developer|engineer|technical consultant)\b/i,
  // An SAP materials management or procurement title, never a developer, technical or Ariba one.
  "sap-mm-consultant": /^(?=.*\bsap\b)(?!.*\b(abap|developer|technical|ariba)\b).*\b(mm|mm-im|materials management|procurement|sourcing (and|&) procurement|purchasing)\b.*\b(consultant|analyst|lead|specialist|architect)\b/i,
  // An SAP sales and distribution or order-to-cash title, never a developer or technical one.
  "sap-sd-consultant": /^(?=.*\bsap\b)(?!.*\b(abap|developer|technical)\b).*\b(sd|sales (and|&) distribution|otc|o2c|order to cash)\b.*\b(consultant|analyst|lead|specialist|architect)\b/i,
  // An SAP production planning or manufacturing title, never a developer or technical one.
  "sap-pp-consultant": /^(?=.*\bsap\b)(?!.*\b(abap|developer|technical|execution)\b).*\b(pp|pp-pi|production planning|manufacturing)\b.*\b(consultant|analyst|lead|specialist|architect)\b/i,
  // An SAP finance title, never a developer or technical one (the ABAP rule below).
  "sap-fico-consultant": /^(?=.*\bsap\b)(?!.*\b(abap|developer|technical)\b).*\b(fico|fi\/co|fi-co|fi|co|finance|financial accounting|controlling)\b.*\b(consultant|analyst|lead|specialist|architect)\b/i,
  "sap-abap-developer": /^(?=.*\b(developer|consultant|engineer|lead|programmer)\b).*\babap\b|\bsap technical consultant\b/i,
  // SAP Fiori and UI5 titles (tech batch TG1), after the ABAP rule ("SAP ABAP Fiori Developer" stays ABAP).
  "sap-fiori-ui5-developer": /^(?!.*\b(test|tester|testing|qa)\b).*\b(fiori|sap ?ui5|ui5|openui5)\b.*\b(developer|consultant|engineer|lead|architect|programmer)\b/i,
  // SAP Integration Suite (CPI) and BTP integration titles (tech batch TG1), after the ABAP rule; a plain "SAP PI/PO
  // Developer" has no rule.
  "sap-btp-integration-developer": /^(?=.*\bsap\b)(?!.*\b(test|tester|testing|qa|basis)\b).*\b(cpi|integration suite|cloud platform integration|cloud integration|hci|btp( integration)?)\b.*\b(developer|consultant|engineer|lead|architect|specialist)\b/i,
  // Guidewire InsuranceSuite titles (tech batch TG1), before the integration rule ("Guidewire Integration Developer");
  // a Guidewire business analyst stays a business analyst (above), and never a test one.
  "guidewire-developer": /^(?!.*\b(test|tester|testing|qa)\b).*\b(guidewire|policycenter|claimcenter|billingcenter|gosu)\b.*\b(developer|engineer|consultant|programmer|lead|architect|specialist)\b/i,
  // A Pega title, never a business analyst (above) or test one; "Pega" counts only as a whole word.
  "pega-developer": /^(?!.*\b(test|tester|testing|qa)\b)(?=.*\b(developer|engineer|programmer|architect|consultant|lead)\b).*\b(pega|pegasystems)\b/i,
  // A Dynamics 365 CE or CRM title, never a Finance and Operations, Business Central or functional one.
  "dynamics-365-developer": /^(?!.*\b(finance (and|&) operations|f&o|fno|business central|ax|nav|functional)\b)(?=.*\b(developer|engineer|programmer|technical consultant)\b).*\b(dynamics 365|dynamics crm|dynamics ce|microsoft dynamics|d365|ms ?crm|microsoft crm)\b/i,
  "power-platform-developer": /^(?=.*\b(developer|engineer|consultant)\b).*\b(power platform|power ?apps|power automate)\b/i,
  // After the Power Platform rule, which keeps "SharePoint and Power Apps Developer"; a SharePoint admin is Microsoft 365.
  "sharepoint-developer": /^(?!.*\b(test|tester|testing|qa|administrator|admin)\b).*\b(sharepoint|spfx)\b.*\b(developer|engineer|consultant|programmer)\b|\b(m365|microsoft 365|office ?365) developer\b/i,
  // An Appian, OutSystems or Mendix title after the Pega and Power Platform rules, before the software rule
  // ("Low-Code Application Developer").
  "low-code-developer": /^(?!.*\b(test|tester|testing|qa)\b)(?=.*\b(developer|engineer|programmer|designer|consultant|architect|lead)\b).*\b(appian|outsystems|mendix|low[- ]?code)\b/i,
  // A Teamcenter, Windchill or PLM software title before the integration and software rules ("PLM Software Engineer");
  // a functional PLM consultant stays a business analyst (above).
  "plm-developer": /^(?!.*\b(test|tester|testing|qa)\b)(?=.*\b(developer|engineer|programmer|technical consultant|architect)\b).*\b(plm|teamcenter|windchill|enovia|3dexperience)\b/i,
  // A SaaS implementation or customer onboarding title after the platform rules ("Workday Implementation Consultant"
  // stays Workday); never an SAP, ERP or project one, nor a bank's KYC or an HR onboarding one.
  "implementation-consultant": /^(?!.*\b(sap|erp|project|kyc|aml|client|hr|employee|vendor|supplier)\b).*(\b((saas|software|product|customer|technical|solutions?) )?implementation (consultant|specialist|analyst|manager|lead)\b|\b(saas|customer|technical) onboarding (consultant|specialist|manager)\b|\bonboarding consultant\b|\bprofessional services consultant\b)/i,
  "mainframe-developer": /^(?!.*\b(test|tester|testing|qa)\b).*\b(mainframe|cobol)\b.*\b(developer|programmer|engineer)\b/i,
  // A build or release title before the integration and DevOps rules; "CI/CD Engineer" stays DevOps, and an "SCM
  // Engineer" in a supply chain title is not one.
  "build-release-engineer": /^(?!.*\b(supply chain|logistics|procurement|warehouse)\b).*\b(build( (and|&) (release|integration))?|release( management)?|build automation|scm|software configuration management) engineer\b/i,
  // A Linux kernel or driver title before the integration, embedded and software rules ("Kernel Software Engineer");
  // never a test, Windows driver or GPU kernel one.
  "linux-kernel-developer": /^(?!.*\b(test|tester|testing|qa|validation|windows|gpu|cuda|hpc|bypass)\b)(?=.*\b(engineer|developer|programmer)\b).*\b(linux (kernel|(device )?drivers?)|kernel)\b/i,
  // An AUTOSAR or MCAL title before the integration and embedded rules ("AUTOSAR Integration Engineer"); never a test or
  // validation one.
  "autosar-engineer": /^(?!.*\b(test|tester|testing|qa|validation)\b).*\b(autosar|mcal|bsw)\b.*\b(engineer|developer|integrator|architect|lead|specialist|consultant)\b/i,
  // A MuleSoft, Boomi or middleware title after the data, Oracle and Salesforce rules ("Data Integration Engineer"), never
  // a test, systems, network or SAP integration one.
  "integration-developer": /^(?!.*\b(test|tester|testing|qa|systems?|hardware|network|sap)\b).*\b(mulesoft|mule|boomi|middleware|(api )?integration)( integration)? (developer|engineer|consultant|specialist)\b/i,
  // A post-silicon validation or bring-up title; never a firmware, FPGA or software one, nor a pharma computer system
  // validation one.
  "post-silicon-validation-engineer": /^(?!.*\b(software|firmware|fpga|pharma|computer system|process|cleaning|equipment|clinical|medical)\b).*\b(post[- ]?si(licon)?|silicon|soc|chip|platform|pcie|ddr|usb|memory) (validation|bring[- ]?up)( and debug)? (engineer|lead|specialist)\b/i,
  // An FPGA title before the chip design and embedded rules ("FPGA Firmware Engineer"); never a test, validation or
  // software one.
  "fpga-engineer": /^(?!.*\b(test|tester|testing|qa|validation|software)\b).*\bfpga\b.*\b(engineer|developer|designer)\b/i,
  // Chip physical design and timing titles (tech batch TG1), before the chip design and verification rules
  // ("Physical Verification Engineer"); never a PCB, board, mechanical or analog layout one.
  "physical-design-engineer": /^(?!.*\b(software|pcb|board|mechanical|analog|security)\b)(?=.*\b(engineer|lead|specialist)\b).*(\bphysical (design|verification|implementation)\b|\bpd engineer\b|\b(sta|static timing( analysis)?|timing (signoff|sign-off|closure)|place (and|&) route|pnr|p&r) engineer\b)/i,
  // Chip design verification titles (tech batch TG1; moved from the chip design rule), before it; never a software,
  // FPGA, validation or physical one.
  "design-verification-engineer": /^(?!.*\b(software|firmware|fpga|validation|physical|process|pharma|clinical)\b)(.*\b(design|asic|soc|ip|rtl|uvm|vlsi|pre-?silicon|hardware|functional|gpu|cpu|chip|silicon|formal) verification engineer\b|.*\bdv engineer\b|.*\bverification engineer\b.*\b(asic|soc|uvm|systemverilog|vlsi|silicon)\b|^((senior|sr\.?|junior|jr\.?|lead) )?verification engineer$)/i,
  // A chip design title (front end: RTL), never a post-silicon validation one; chip verification titles read as design
  // verification (above).
  "vlsi-design-engineer": /^(?!.*\b(validation|software|physical design|analog|dft)\b).*\b(vlsi|asic|rtl|soc design|digital (ic )?design|chip design|silicon design)\b.*\b(engineer|developer)\b/i,
  // A board or electronics hardware design title after the FPGA and chip design rules, before the embedded rule ("ECU
  // Hardware Engineer"); never a test, software, chip, IT, networking or plant one. A plain "Hardware Engineer" has no
  // rule (it is often IT hardware).
  "hardware-design-engineer": /^(?!.*\b(test|tester|testing|qa|validation|verification|software|firmware|fpga|asic|rtl|vlsi|silicon|soc|chip|technician|support|networking|network|desktop|it|plant|maintenance|field|service)\b).*(\bhardware (design|development)\b|\b(electronics?|board|pcb|schematic|circuit) design engineer\b|\b(ecu|embedded|electronics?|board) hardware (engineer|designer|lead)\b|\b(senior|sr\.?|lead) hardware engineer\b|\bhardware architect\b)/i,
  // A PLC, SCADA or DCS title before the robotics rule; a SCADA security title stays OT security (above), and a plain
  // "Automation Engineer" or "Control Systems Engineer" has no rule.
  "plc-scada-engineer": /^(?!.*\b(security|cyber ?security|test|tester|testing|qa)\b)(.*\b(plc|scada|dcs)\b.*\b(engineer|programmer|developer|specialist|technician|lead|consultant)\b|.*\bindustrial automation (engineer|specialist|lead)\b|.*\bcommissioning engineer\b.*\b(automation|plc|scada|dcs)\b)/i,
  // A robot software title, never an RPA, test (Robot Framework), mechanical or technician one.
  "robotics-engineer": /^(?!.*\b(test|tester|testing|qa|process automation|rpa|robot framework|mechanical|technician)\b).*\b(robotics?|ros( ?2)?|slam|motion planning|autonomy|autonomous (navigation|systems?|vehicles?)|robot navigation)\b.*\b(engineer|developer|programmer)\b/i,
  // Never a test or validation title: those stay with hardware testing, which no role covers.
  "embedded-software-engineer": /^(?!.*\b(test|tester|testing|validation|qa)\b).*\b(embedded|firmware)\b.*\b(engineer|developer|programmer)\b/i,
  // Before the game rule, which would read "Unity" in "Unity XR Developer".
  "ar-vr-developer": /^(?!.*\b(test|tester|testing|qa)\b).*\b(ar|vr|xr|augmented reality|virtual reality|mixed reality|extended reality|spatial computing|webxr)\b.*\b(developer|engineer|programmer)\b/i,
  // Before the mobile, front-end and full-stack rules ("Mobile Game Developer", "Web3 Developer").
  "game-developer": /^(?!.*\b(test|tester|testing|qa)\b).*\b(game|gameplay|unity( ?3d)?|unreal( engine)?)\b.*\b(developer|programmer|engineer)\b/i,
  "blockchain-developer": /^(?!.*\b(test|tester|testing|qa)\b).*\b(blockchain|solidity|smart contracts?|web3|dapp|hyperledger( fabric)?|ethereum)\b.*\b(developer|engineer|programmer)\b/i,
  "php-developer": /^(?!.*\b(full[- ]?stack|test|tester|testing|qa)\b).*\b(php|laravel|codeigniter|symfony|cakephp|wordpress)\b.*\b(developer|engineer|programmer)\b/i,
  // After the embedded rule, which keeps firmware titles; before the software rule ("IoT Software Engineer").
  "iot-engineer": /^(?!.*\b(test|tester|testing|qa|validation)\b).*\b(iot|iiot|internet of things|edge gateway|connected devices?)\b.*\b(engineer|developer|programmer)\b/i,
  // A GIS or geospatial software title; a plain "GIS Analyst" has no rule.
  "gis-developer": /^(?!.*\b(test|tester|testing|qa)\b).*\b(gis|geospatial|arcgis|esri|qgis)\b.*\b(developer|engineer|programmer)\b/i,
  // A quant, HFT or trading systems title before the C++ and software rules ("Low Latency C++ Developer"); never a quant
  // analyst or researcher one.
  "quant-developer": /^(?!.*\b(test|tester|testing|qa|analyst|researcher)\b)(?=.*\b(developer|engineer|programmer)\b)(.*\b(quant(itative)?|hft|high[- ]frequency trading|algo(rithmic)? trading|trading (systems?|platform|infrastructure)|electronic trading)\b|.*\blow[- ]latency (c\+\+|trading|software|systems))/i,
  // A Rust title after the embedded and blockchain rules, before the C++, backend and software rules; never a test one.
  "rust-developer": /^(?!.*\b(test|tester|testing|qa|sdet|corrosion|coating|prevention)\b)(?=.*\b(developer|engineer|programmer)\b).*\brust\b/i,
  // A C++ title after the embedded, game and IoT rules; never a test one. "C" and "C#" titles stay out.
  "cpp-developer": /^(?!.*\b(test|tester|testing|qa|sdet)\b)(?=.*\b(developer|engineer|programmer)\b).*(?<![\w+#])(c\/c\+\+|c\+\+|cpp)(?![\w+#])/i,
  // A Ruby or Rails title before the full-stack rule; never a test one, and "Rails" only as a whole word.
  "ruby-on-rails-developer": /^(?!.*\b(test|tester|testing|qa|sdet)\b)(?=.*\b(developer|engineer|programmer)\b).*\b(ruby on rails|ruby|rails|ror)\b/i,
  "android-developer": /\bandroid\b.*\b(engineer|developer)\b|\b(engineer|developer)\b.*\bandroid\b|^(?!.*\b(back[- ]?end|server[- ]side|spring)\b).*\b(kotlin|jetpack compose)\b.*\b(engineer|developer)\b/i,
  "ios-developer": /\bios\b.*\b(engineer|developer)\b|\b(engineer|developer)\b.*\bios\b|\b(iphone( app)?|swift|swiftui) (engineer|developer)\b/i,
  "cross-platform-mobile-developer": /\b(react native|flutter|mobile( app)?|cross[- ]platform( app| mobile)?)\b.*\b(engineer|developer)\b/i,
  // A technical lead title, never a test, QA or backend one ("Backend Tech Lead" is a senior backend title, below).
  "tech-lead": /^(?!.*\b(test|testing|qa|sdet|quality|back[- ]?end)\b).*\b(tech(nical)?( team)? lead|lead software (engineer|developer)|software development lead)\b/i,
  // Not a test, front-end, mobile, ML, data, security, cloud or infrastructure title ("Senior Software Engineer, Data"):\n  // the later rules catch those.
  "senior-backend-engineer": /\b(senior|sr\.?|lead) (software|back[- ]?end|java|python|golang|go|node(\.?js)?|server[- ]side) (engineer|developer)\b(?!.*\b(test|qa|sdet|front[- ]?end|ui|mobile|android|ios|full[- ]?stack|machine learning|ml|ai|data|security|infra(structure)?|platform|cloud|sre|site reliability|devops)\b)|^(?!.*\b(test|qa)\b).*\b(software (development )?engineer|sde),? (iii|3)\b|\b(staff|principal) back[- ]?end (engineer|developer)\b|\bback[- ]?end tech(nical)? lead\b/i,
  "python-developer": /^(?!.*\b(full[- ]?stack|test|tester|testing|qa|sdet|automation)\b).*\b(python|django|flask|fastapi)\b.*\b(engineer|developer|programmer)\b/i,
  "nodejs-developer": /^(?!.*\b(full[- ]?stack|mern|mean|test|tester|testing|qa|sdet|automation)\b)(?=.*\b(engineer|developer|programmer)\b).*\b(node(\.?js)?|nest\.?js)\b/i,
  "golang-developer": /^(?!.*\b(full[- ]?stack|test|tester|testing|qa|sdet|automation)\b)(?=.*\b(engineer|developer|programmer|sde)\b).*(\bgolang\b|\bgo (back[- ]?end )?(engineer|developer|programmer)\b|\s[-–,]\s?go$)/i,
  "dotnet-developer": /^(?!.*\b(test|tester|testing|qa|sdet)\b)(?=.*\b(engineer|developer|programmer|lead)\b).*(?<![\w.])(\.net|dot ?net|asp\.net|c#|vb\.net)(?![\w#])/i,
  "java-backend-developer": /\b(back[- ]?end|java|server[- ]side|spring( boot)?|j2ee)\b.*\b(engineer|developer)\b|\b(software|backend) (engineer|developer)\b.*\bjava\b/i,
  // A front-end architect, or a principal or staff front-end engineer, before the front-end and solutions architect rules.
  "frontend-architect": /\b(front[- ]?end|ui|react|angular|javascript|web)( technical| solutions?)? architect\b|\b(principal|staff) front[- ]?end (engineer|developer)\b/i,
  "frontend-developer": /^(?!.*\b(full[- ]?stack|mern|mean)\b).*(\b(front[- ]?end|ui|react|reactjs|react\.js|javascript|next\.?js|web)\b.*\b(engineer|developer)\b|\b(engineer|developer)\b.*\b(front[- ]?end|react)\b)/i,
  "full-stack-developer": /\bfull[- ]?stack\b|\b(mern|mean) stack\b/i,
  // IT service delivery and major incident titles (tech batch TG1), before the program and project rules; never a
  // logistics, BPO, customer service or facilities one, and a plain "Change Manager" has no rule.
  "it-service-delivery-manager": /^(?!.*\b(logistics|warehouse|retail|hospital|healthcare|bpo|voice|customer service|facilit(y|ies)|hr|payroll|telecom|field)\b)(.*\b((it|itsm|technical) )?service delivery (manager|lead)\b|.*\bservice level manager\b|.*\bservice manager\b.*\b(managed services|itsm|it operations)\b|.*\b(major )?incident manager\b|.*\bproblem manager\b|.*\b(it|itsm|itil) change manager\b)/i,
  // A technical or engineering program title; a plain "Program Manager" has no rule, and an IT project one is below.
  "technical-program-manager": /\b(technical|engineering) (program|programme|project) manager\b|\bprogram(me)? manager,? ?[-–]? ?(engineering|technical)\b/i,
  "scrum-master": /\b(scrum master|agile (coach|delivery lead|project manager)|iteration manager)\b/i,
  // An IT, software or ERP project title after the technical program and agile rules; a plain "Project Manager" has no
  // rule, and never a civil, construction, plant or marketing one ("Project Manager - Infrastructure" can be a road).
  "it-project-manager": /^(?!.*\b(civil|construction|mechanical|electrical|solar|epc|real estate|interior|site|plant|marketing|clinical|highway|roads?)\b).*(\b(it|software|erp|sap|application|technology|implementation|it infrastructure) project (manager|lead)\b|\bproject manager\b.*\b(it|software|erp|sap|application delivery|implementation|it infrastructure|infrastructure)\b|\b(it )?pmo (manager|lead)\b)/i,
  "engineering-manager": /\b(engineering manager|manager,? (software )?engineering|software (development|engineering) manager|head of engineering|director of engineering|engineering director|tech lead manager)\b|^((senior|sr\.?) )?(development manager|technical manager|engineering lead)\b/i,
  "senior-data-scientist": /\b(senior|sr\.?|lead|staff|principal) (data|applied|ml|machine learning) scientist\b|\bdata science (lead|manager)\b/i,
  "data-scientist": /\b(data scientist|machine learning scientist|applied scientist|ml scientist|decision scientist|data science (associate|analyst)|(predictive|statistical) model(l)?er)\b/i,
  // An AI, ML or generative AI product title before the product rule.
  "ai-product-manager": /^(?=.*\b(product manager|product owner|product lead)\b).*\b(ai|ml|genai|gen ai|generative ai|llm|machine learning|artificial intelligence)\b/i,
  "product-manager": /\b(product manager|product owner|associate product manager|product lead|product specialist)\b/i,
  // A user research title before the designer rule, which keeps "UX Writer".
  "ux-researcher": /\b(ux|user|design|product|user experience|usability) research(er| lead| specialist| analyst)\b|\busability (analyst|specialist)\b/i,
  "ui-ux-designer": /\b(ui ?\/? ?ux|ux ?\/? ?ui|ux|ui|product|interaction|visual|(?<!learning )experience|web) designer\b|\bux writer\b/i,
  // After the designer rule, which keeps "UX Writer".
  "technical-writer": /\b(technical|api|documentation|docs) (writer|author|editor)\b|\bdocumentation (specialist|engineer|lead)\b|\binformation developer\b|\bcontent developer\b.*\btechnical\b/i,
  "qa-automation-engineer": /\b(qa|sdet|test|testing|quality|automation test)\b.*\b(engineer|analyst|developer)\b|\bsdet\b|\bsoftware (development )?engineer\b.*\b(in test|qa|quality)\b|\bautomation tester\b|\b(manual|automation)( (&|and) (manual|automation))? testing\b|\bselenium\b.*\b(engineer|tester|developer)\b/i,
  // Core engineering roles (fresher batch F1), before site reliability: a production engineer whose title names a plant,
  // a line or a shop-floor process (or a junior or trainee one) is the manufacturing role, and a plain, senior or
  // infrastructure "Production Engineer" stays site reliability. None reads a software, IT or data title.
  "production-engineer": /^(?!.*\b(software|developer|data|cloud|platform|infrastructure|site reliability|sre|network|it|devops|support|systems?)\b)(((junior|jr\.?|trainee|graduate|assistant|associate|shift|plant|mechanical|manufacturing) )*production engineer\b.*\b(manufacturing|machining|assembly|plant|shop ?floor|press shop|paint shop|body shop|moulding|molding|welding|fabrication|foundry|forging|casting|automotive|cnc|sheet metal)\b|((junior|jr\.?|trainee|graduate) )+production engineer\b|(mechanical|manufacturing|plant) production engineer\b|((shift|assistant|graduate|junior|jr\.?|trainee) )*engineer,? ?[-–]? ?production\b|production shift (incharge|in-charge|engineer)\b)/i,
  // Plant maintenance engineers, never a software, application, aircraft or building one.
  "maintenance-engineer": /^(?!.*\b(software|developer|data|it|network|cloud|application|app|systems?|database|sap|aircraft|aviation|building|facility|facilities)\b)((junior|jr\.?|senior|sr\.?|assistant|associate|trainee|graduate|shift|plant|front ?line|mechanical|electrical|utility|utilities) )*(((plant|mechanical|electrical|utility|utilities|breakdown|preventive) )?maintenance engineer|engineer,? ?[-–]? ?((mechanical|electrical|plant|utility) )?maintenance)\b/i,
  // Mechanical design and CAD engineers, before the mechanical trainee rule so a mechanical design trainee reads here.
  "mechanical-design-engineer": /^(?!.*\b(software|developer|data|it|electrical|electronics?|hardware|pcb|vlsi|asic|rtl|chip|silicon|ui|ux|graphic|interior|fashion|civil|structural)\b)(((junior|jr\.?|senior|sr\.?|associate|assistant|trainee|graduate|cad|product) )*(mechanical (design|cad) engineer|(design|cad) engineer\b.*\bmechanical|(solidworks|solid works|creo|catia|nx|unigraphics|inventor) (design )?engineer)|(graduate engineer(ing)? trainee|graduate trainee engineer|get|engineer(ing)? trainee|trainee engineer|engineering executive trainee|graduate apprentice( trainee| engineer)?|apprentice engineer)\b.*\bmechanical design)\b/i,
  // Mechanical graduate engineer trainees.
  "graduate-engineer-trainee-mechanical": /^(?!.*\b(software|developer|data|it|design|civil|electrical|electronics)\b)(((junior|jr\.?) )?(graduate engineer(ing)? trainee|graduate trainee engineer|get|engineer(ing)? trainee|trainee engineer|engineering executive trainee|graduate apprentice( trainee| engineer)?|apprentice engineer)\b.*\b(mechanical|production|manufacturing)\b|mechanical (graduate )?engineer(ing)? trainee\b)/i,
  // Electrical graduate engineer trainees and junior substation or EPC engineers; a plain "Electrical Engineer" or an
  // electronics trainee has no rule.
  "graduate-engineer-trainee-electrical": /^(?!.*\b(software|developer|data|it|design|pcb|embedded|firmware|hardware|electronics(?! and)|maintenance)\b)(((junior|jr\.?) )?(graduate engineer(ing)? trainee|graduate trainee engineer|get|engineer(ing)? trainee|trainee engineer|engineering executive trainee|graduate apprentice( trainee| engineer)?|apprentice engineer)\b.*\b(electrical|power|power distribution|substation|transmission)\b|electrical (graduate )?engineer(ing)? trainee\b|((junior|jr\.?|trainee|graduate|assistant) )+electrical engineer\b.*\b(substation|epc|power|distribution|transmission)\b)/i,
  // Civil site and execution engineers, never a telecom, solar, MEP, design or billing one; a plain "Civil Engineer"
  // has no rule.
  "site-engineer-civil": /^(?!.*\b(software|developer|data|it|network|telecom|rf|ran|solar|electrical|mechanical|hvac|mep|fire|billing|quantity|qs|estimation|design|structural|planning)\b)((junior|jr\.?|senior|sr\.?|assistant|associate|trainee|graduate|civil) )*((civil )?site (execution )?engineer|(site )?execution engineer\b.*\bcivil|engineer,? ?[-–]? ?civil( (site|execution|works))?|civil engineer,? ?[-–]? ?(site|execution)|(graduate engineer(ing)? trainee|graduate trainee engineer|get|engineer(ing)? trainee|trainee engineer|engineering executive trainee|graduate apprentice( trainee| engineer)?|apprentice engineer)\b.*\bcivil)\b/i,
  // Civil billing engineers and quantity surveyors, never a software, telecom, medical or MEP billing title.
  "billing-quantity-engineer-civil": /^(?!.*\b(software|developer|data|it|sap|telecom|medical|hospital|insurance|electrical|mechanical|mep|hvac)\b)((junior|jr\.?|senior|sr\.?|assistant|associate|trainee|graduate|site|civil) )*((billing|qs|quantity surveying|estimation (and|&) billing|billing (and|&) (qs|quantity surveying|estimation)|qs (and|&) billing) engineer|quantity surveyor|engineer,? ?[-–]? ?(billing|qs|quantity surveying))\b/i,
  // Reliability and production engineers in software only, never in a plant or on hardware.
  "site-reliability-engineer": /\b(site reliability|sre)\b|^(?!.*\b(hardware|mechanical|manufacturing|plant|electrical|civil|chemical|silicon|asic)\b).*\b(((systems?|infrastructure|platform) )?reliability|observability|production) engineer\b/i,
  // An AI, ML or generative AI architect title before the cloud and solutions architect rules ("GenAI Solution Architect").
  "ai-architect": /(?<![\w/])(ai|ai\/ml|ml\/ai|ml|machine learning|gen(erative)?[- ]?ai|llm|applied ai|agentic ai|conversational ai)( solutions?| platform)? architect\b/i,
  "cloud-architect": /\b(cloud( solutions?| infrastructure| platform)? architect|(aws|azure|gcp|google cloud|multi-?cloud|hybrid cloud)( cloud)?( solutions?)? architect)\b/i,
  "solutions-architect": /\b(solutions?|technical|software|application|integration|enterprise|pre-?sales) architect\b/i,
  "cloud-engineer": /\b(cloud( solutions?| infrastructure)? (engineer|consultant|administrator|developer|operations|ops)|(aws|azure|gcp|google cloud)( solutions?)? (engineer|consultant|administrator|developer))\b|\bsoftware (engineer|developer)\b.*\bcloud\b/i,
  // A platform title before DevOps, never a DevOps or reliability one; "ML Platform Engineer" is MLOps (above).
  "platform-engineer": /^(?!.*\b(devops|devsecops|reliability|sre)\b).*(\bplatform (engineer|engineering|developer)\b|\b(engineer|developer)\b.*\bplatform\b)/i,
  "devops-engineer": /\b(devops|infrastructure engineer|(ci\/cd|infrastructure automation|kubernetes) engineer)\b|\bsoftware (engineer|developer)\b.*\binfra(structure)?\b/i,
  // Last of the engineering roles: a plain "Software Engineer" or "SDE", never a test, embedded or hardware one.
  "software-engineer": /^(?!.*\b(in test|qa|embedded|firmware|hardware|silicon|asic|mechanical|electrical)\b).*\b(software (engineer|developer|development engineer)|sde|programmer analyst|application developer|member of technical staff|back[- ]?end (engineer|developer))\b|^((senior|sr\.?) )?mts\b/i,
  // Social media managers, leads and strategists (batch B2) before digital marketing; a "Social Media Executive" stays
  // digital marketing, and a community manager only when the title says social media.
  "social-media-manager": /^((senior|sr\.?|lead|associate|assistant|deputy|brand) )*((influencer (and|&) )?social media( (and|&) (community|influencer))?( marketing)? (manager|lead|strategist)|social media strategy (manager|lead))\b|^((senior|sr\.?) )?community manager\b.*\bsocial media\b/i,
  // SEO specialists, analysts, managers and leads (batch B3) before digital marketing; an "SEO Executive" stays digital
  // marketing, and an SEO engineer or developer is not one.
  "seo-specialist": /^((senior|sr\.?|junior|jr\.?|lead|associate|technical|on-page|off-page) )*(seo|search engine optimi[sz]ation) (specialist|analyst|manager|lead|strategist|consultant)\b/i,
  "digital-marketing-executive": /\b(digital|performance|growth|paid|search|seo|sem|social media|content|lifecycle|email|online) market(ing|er)\b|\b(seo|sem|ppc|paid social|paid search|social media) (specialist|executive|manager|associate)\b/i,
  // Business roles (batches B1 to B4, and F1), last, each read only from the titles it is built for. A plain "Account
  // Executive", "Sales Manager", "Sales Executive", "Account Manager" or "Relationship Manager" has no rule.
  "product-marketing-manager": /\bproduct marketing (manager|lead|specialist|associate|executive)\b|^manager,? ?[-–]? ?product marketing\b/i,
  "key-account-manager": /^((senior|sr\.?|national|regional|zonal|corporate|associate|deputy|assistant) )*key accounts? (manager|executive|lead|specialist)\b|^((senior|sr\.?|deputy|assistant) )?modern trade (manager|executive|lead)\b/i,
  // Batch F1. FMCG and general trade sales officers, before area sales and business development so a territory or field
  // sales officer whose title names FMCG, general trade or consumer goods reads here; a plain "Sales Officer" has no rule.
  "fmcg-sales-officer": /^(?!.*\b(software|saas|it|pharma\w*|medical|home loans?|housing|mortgage|insurance|real estate|loans?|banking|cards?|b2b)\b)((senior|sr\.?|junior|jr\.?|trainee|field|territory) )*((sales (officer|executive|trainee|representative)|territory sales (in-?charge|incharge))\b.*\b(fmcg|general trade|consumer goods|consumer products|cpg)\b|(fmcg|general trade|consumer goods|cpg) sales (officer|executive|trainee|representative))/i,
  "area-sales-manager": /^((senior|sr\.?|deputy|assistant) )?((area|territory) sales (manager|officer|executive|lead)|area manager\b.*\bsales|area business manager)\b/i,
  "inside-sales-executive": /^((senior|sr\.?|associate|junior|jr\.?) )?(inside sales (executive|representative|rep|associate|specialist)|(sales|business) development (representative|rep)|sdr|bdr)\b|^account executive\b.*\binside sales\b/i,
  // FP&A and business finance analysts; never a financial systems, crime, data or cloud cost one.
  "financial-analyst": /^(?!.*\b(systems?|crime|data|cloud|software|it)\b)((senior|sr\.?|associate|junior|jr\.?|lead) )?(fp ?& ?a|financial planning (and|&) analysis|business finance|commercial finance|budgeting (and|&) forecasting|financial|finance) (analyst|associate)\b/i,
  // "Accounts Executive" in finance, never the sales "Account Executive"; a forensic or chartered accountant is not one.
  "accounts-executive": /^((senior|sr\.?|junior|jr\.?|assistant) )?(accounts( (and|&) (taxation|tax|finance|admin))?|accounts payable|accounts receivable) (executive|assistant|officer|associate)\b|^executive,? ?[-–]? ?accounts\b|^((junior|jr\.?|assistant) )?((tally|gst) )?accountant\b|^accounts (payable|receivable) specialist\b/i,
  "credit-risk-analyst": /^(?!.*\b(model(l)?(er|ing)?|models?|quant|data|engineer|developer|card)\b)((senior|sr\.?|associate|junior|jr\.?|lead) )?((wholesale|retail|corporate|sme|msme|commercial|consumer) )?(credit risk|credit portfolio|credit appraisal|credit) (analyst|underwriter|officer)\b/i,
  "aml-kyc-analyst": /^(?!.*\b(engineer|developer|data|software|test|tester|qa)\b).*\b(aml|kyc|cdd|edd|anti[- ]money laundering|transaction monitoring|sanctions|financial crime|fcc|customer due diligence)(\/(aml|kyc))?( (due diligence|operations|compliance|screening|review|investigations?))? (analyst|investigator|specialist|associate|officer|reviewer)\b/i,
  // Batch B4. Plant industrial relations and labour welfare officers, before HR generalist so an HR officer whose title
  // says industrial relations reads here; employee relations (an HR policy job) and investor relations are not one.
  "industrial-relations-officer": /^(?!.*\b(software|engineer|developer|data|investor|employee)\b)((senior|sr\.?|junior|jr\.?|assistant|deputy|plant|factory|site) )*((((hr|personnel|human resources?) (and|&) )?(industrial relations|ir|labou?r relations)( (and|&) (compliance|admin(istration)?|welfare|hr))?|labou?r welfare) (officer|executive|specialist|associate|lead)|(hr|personnel) (officer|executive)\b.*\b(industrial relations|ir)|executive,? ?[-–]? ?industrial relations)\b/i,
  "hr-generalist": /^((senior|sr\.?|junior|jr\.?|associate|assistant|plant|factory|site|corporate) )*(hr|human resources?|people operations|people ops)( (and|&) admin(istration)?| operations| ops)? (generalist|executive|officer|associate|coordinator)\b/i,
  // Recruiter and talent acquisition titles; an SAP or SuccessFactors recruiting one stays with those rules above.
  "talent-acquisition-specialist": /^((senior|sr\.?|junior|jr\.?|associate|lead|corporate|campus|non-it|it|technical|tech) )*((talent acquisition|recruitment) (specialist|executive|partner|associate|consultant|coordinator|lead)|recruiter)\b/i,
  "supply-chain-analyst": /^(?!.*\b(engineer|developer|data|software|sap|consultant)\b)((senior|sr\.?|junior|jr\.?|associate|lead) )?((supply chain( planning)?|supply planning|demand planning|inventory( control| planning)?|procurement|logistics|sourcing|s&op) analyst|(demand|supply) planner)\b/i,
  // Batch B2. A banking relationship manager only when the title names retail, branch, priority or wealth banking,
  // never a corporate, SME or insurance one.
  "relationship-manager-banking": /^(?!.*\b(corporate|commercial|business banking|sme|msme|wholesale|insurance)\b)((senior|sr\.?|deputy|assistant|associate) )*(((priority|premier|preferred|privilege|wealth|personal|hni|branch|retail|liabilities|casa)( banking)? )+relationship manager|relationship manager\b.*\b(retail|branch|priority|premier|wealth|hni|casa|liabilities|banking)\b|personal banker)\b/i,
  // Field and new business sales executives; a "Business Development Representative" stays inside sales (above), and a
  // plain "Sales Executive" or "Business Development Manager" has no rule.
  "business-development-executive": /^((senior|sr\.?|junior|jr\.?|associate|field|corporate|b2b) )*(business development (executive|officer|associate)|bde)\b|^((senior|sr\.?) )?(corporate|field|b2b) sales (executive|officer)\b|^sales executive\b.*\bnew business\b/i,
  // Content and SEO writers and copy editors, never a technical, API or documentation one.
  "content-writer": /^(?!.*\b(technical|api|documentation|docs|medical|legal)\b)((senior|sr\.?|junior|jr\.?|associate|freelance) )?((seo|web|website|blog|digital|marketing|b2b) )?(content writer|content editor|blog writer|copy editor)\b|^((senior|sr\.?) )?content specialist\b.*\bseo\b/i,
  // Direct and indirect tax (GST, TDS) executives and associates; an "Accounts and Taxation Executive" stays accounts
  // (above), and a tax technology one has no rule.
  "tax-associate": /^(?!.*\b(technology|engineer|developer|software|systems?|data|sap|consultant)\b)((senior|sr\.?|junior|jr\.?|assistant) )?(associate,? ?[-–]? ?(business |direct |indirect )?tax\b|((direct|indirect|business|corporate|income) )?(tax|taxation)( (and|&) (compliance|audit))? (associate|executive|analyst|officer|assistant)\b|gst( (and|&) tds)?( compliance)? (executive|associate|analyst)\b)/i,
  // Statutory, internal and assurance audit staff; an IT, quality or clinical audit title is not one.
  "audit-associate": /^(?!.*\b(it|is|information|cyber|security|technology|data|clinical|quality|safety|energy|software|sox it)\b)((senior|sr\.?|junior|jr\.?|assistant|statutory|internal|external) )*((audit( (and|&) assurance)?|assurance) (associate|executive|assistant|officer|senior assistant)|internal auditor|audit senior)\b/i,
  // Loan and card collections and recoveries; never a sample, data or other kind of collection.
  "collections-officer": /^((senior|sr\.?|deputy|assistant|area|field|tele|telecalling|credit card|retail|loan) )*(collections?( (and|&) recover(y|ies))?|recover(y|ies)) (officer|executive|associate|agent|manager|specialist)\b|^debt (manager|collection officer|recovery officer)\b.*\brecover/i,
  "treasury-analyst": /^(?!.*\b(systems?|technology|developer|engineer|software|data|it)\b)((senior|sr\.?|junior|jr\.?|associate) )?(((corporate|forex (and|&)) )?treasury (analyst|executive|associate|officer)|cash management analyst|analyst,? ?[-–]? ?(corporate )?treasury)\b/i,
  "hr-business-partner": /^((senior|sr\.?|lead|associate|strategic|plant|regional|corporate) )*((hr|human resources?|people) business partner|business hr partner|people partner|hrbp)\b/i,
  // Payroll staff, never an SAP, Workday or other payroll systems one.
  "payroll-executive": /^(?!.*\b(sap|workday|oracle|developer|engineer|systems?|software|consultant|implementation)\b)((senior|sr\.?|junior|jr\.?|associate|assistant|lead) )?(payroll( (and|&) (statutory )?compliance)?|payroll operations) (executive|officer|specialist|analyst|associate|administrator|coordinator)\b|^executive,? ?[-–]? ?payroll\b/i,
  // Purchase and sourcing staff; a "Procurement Analyst" stays supply chain analyst (above), and a talent sourcing title
  // is not one.
  "procurement-executive": /^(?!.*\b(engineer|developer|software|data|sap|consultant)\b)((senior|sr\.?|junior|jr\.?|assistant|indirect|direct|strategic) )*((purchase|purchasing|procurement|sourcing|vendor development|supplier development) (executive|officer|specialist|associate|coordinator|assistant)|buyer\b.*\b(procurement|purchase|purchasing|sourcing))\b|^executive,? ?[-–]? ?(purchase|procurement)\b/i,
  // Batch B4. EXIM, DGFT and customs compliance executives, before logistics so an "EXIM Executive" reads here; a
  // logistics, shipping or plain "Export Executive" stays logistics.
  "export-import-executive": /^(?!.*\b(software|engineer|developer|data|sap|analyst|logistics|shipping)\b)((senior|sr\.?|junior|jr\.?|assistant|deputy) )*((exim|export[- ]import|import[- ]export|foreign trade|dgft|customs|export incentives?|export documentation)( (and|&) (dgft|customs|compliance|documentation|exim))?( (compliance|documentation|operations))? (executive|officer|coordinator|specialist|associate|assistant)|executive,? ?[-–]? ?(exim|export[- ]import|import[- ]export|foreign trade|dgft|customs)( (and|&) (dgft|customs))?)\b/i,
  // Logistics, dispatch and shipping coordinators; a "Logistics Analyst" stays supply chain analyst (above).
  "logistics-coordinator": /^(?!.*\b(engineer|developer|software|data|sap|analyst)\b)((senior|sr\.?|junior|jr\.?|assistant|exim|export|import|inbound|outbound) )*(logistics|dispatch|shipping|transport(ation)?|shipment|exim|export|import)( (and|&) (dispatch|warehouse|exim|logistics|shipping|import|export))?( operations)? (executive|coordinator|officer|associate|assistant|specialist)\b|^executive,? ?[-–]? ?(logistics|dispatch)\b/i,
  // Batch B3. Pharma field representatives; a medical device or plain "Sales Representative" is not one.
  "medical-representative": /^((senior|sr\.?|junior|jr\.?|trainee|associate) )*(medical (sales )?representative|medical sales officer|pharma(ceutical)? sales (representative|officer|executive)|professional service representative|therapy business executive|mr\b.*\bpharma)\b/i,
  // Distributor and dealer channel managers, never a software, cloud or partner alliances channel.
  "channel-sales-manager": /^(?!.*\b(saas|software|cloud|alliances?)\b)((senior|sr\.?|deputy|assistant|regional|zonal|area|state) )*(channel (sales|development) (manager|lead)|dealer (network|development) manager|distributor development manager)\b/i,
  // Brand managers, never an employer brand, brand design or brand partnerships title.
  "brand-manager": /^((senior|sr\.?|assistant|associate|deputy|group|category) )*brand (marketing )?manager\b/i,
  // Sell-side and buy-side equity research; a plain "Research Analyst" has no rule.
  "equity-research-analyst": /^(?!.*\b(data|software|engineer|developer|quant(itative)?)\b)((senior|sr\.?|junior|jr\.?|associate|lead) )?(equity research (analyst|associate)|((buy|sell)[- ]side |fundamental )?equity analyst|(research|sector) analyst\b.*\bequit(y|ies))\b/i,
  // Life, health and general insurance underwriters; a credit or loan underwriter stays credit risk (above).
  "insurance-underwriter": /^(?!.*\b(credit|loan|mortgage|software|engineer|developer|data)\b)((senior|sr\.?|junior|jr\.?|assistant|deputy|associate) )*(((group )?(health|life|motor|marine|fire|property|casualty|commercial lines|general|engineering|liability|medical)( (and|&) (engineering|marine|property|casualty))?( insurance)?|insurance) underwriter|underwrit(er|ing) (executive|officer|analyst|specialist|associate)\b.*\binsurance)\b/i,
  // Company secretaries and secretarial staff; a personal or executive secretary is not one.
  "company-secretary-associate": /^((senior|sr\.?|junior|jr\.?|assistant|deputy|associate) )*(company secretary|(company |corporate )?secretarial( compliance)? (executive|associate|assistant|officer|analyst)|associate,? ?[-–]? ?(corporate |company )?secretarial)\b/i,
  // Compensation, benefits and total rewards analysts, never an HR systems one.
  "compensation-benefits-analyst": /^(?!.*\b(engineer|developer|software|systems?|workday|sap|oracle|consultant)\b)((senior|sr\.?|junior|jr\.?|associate|lead) )?(compensation( (and|&) benefits)?|c&b|total rewards?|rewards|benefits) (analyst|specialist|executive|associate)\b/i,
  // Learning and development staff and trainers, never a machine learning one.
  "learning-development-specialist": /^(?!.*\b(software|engineer|developer|machine learning|deep learning|data)\b)((senior|sr\.?|junior|jr\.?|associate|assistant|lead|corporate) )*(((learning|training) (and|&) development|l ?& ?d|t ?& ?d) (specialist|executive|consultant|partner|associate|coordinator|officer|lead|analyst)|(executive|specialist|trainer|consultant),? ?[-–]? ?(learning|training) (and|&) development|(corporate trainer|training specialist)\b.*\b(learning|training) (and|&) development|(learning experience|instructional) designer)\b/i,
  // Warehouse executives, supervisors and shift leads; a "Logistics and Warehouse Executive" stays logistics (above),
  // and a warehouse manager has no rule.
  "warehouse-operations-executive": /^(?!.*\b(engineer|developer|software|data|sap|analyst)\b)((senior|sr\.?|junior|jr\.?|assistant) )*((inventory (and|&) )?warehouse( operations)? (executive|supervisor|officer|coordinator|incharge|in-charge|shift incharge|team lead)|executive,? ?[-–]? ?warehouse( operations)?|(floor|shift) (lead|supervisor|incharge)\b.*\bwarehouse)\b/i,
  // Lean, Six Sigma and process excellence analysts, never a software or IT process one.
  "process-excellence-analyst": /^(?!.*\b(software|engineer|developer|data|it|sap)\b)((senior|sr\.?|junior|jr\.?|associate|lead) )?(((process|operational|operations|business) excellence|process improvement|continuous improvement|lean six sigma|six sigma|quality (and|&) process excellence) (analyst|specialist|associate|executive|consultant|lead)|(lean )?six sigma (green|black) belt)\b/i,
  // Retail store and showroom managers; a stores (materials) or dark store manager is not one.
  "retail-store-manager": /^(?!.*\b(software|engineer|developer|data|it|analyst|app)\b)((senior|sr\.?|assistant|deputy|associate) )*((retail )?store (manager|incharge|in-charge|operations manager)|showroom manager|boutique manager)\b/i,
  // Batch B4 (also industrial relations and EXIM, above). Residential project sales; a plain "Sales Executive", a
  // leasing or commercial real estate title, or a "Real Estate Agent" is not one.
  "real-estate-sales-executive": /^(?!.*\b(software|saas|cloud|engineer|developer|data|it|leasing|commercial|loans?|mortgages?|housing finance)\b)((senior|sr\.?|junior|jr\.?|assistant|deputy|associate|site) )*((real estate|property|residential|realty)( project)? (sales|pre-?sales) (executive|manager|officer|associate|advisor|consultant)|(site |pre-?)?sales (executive|manager|officer|advisor|consultant)\b.*\b(real estate|residential (projects?|real estate)|realty|property)|closing manager\b.*\b(real estate|residential|realty|property))\b/i,
  // Home loan, mortgage and LAP sales officers; a credit, underwriting or collections title stays with those rules.
  "home-loan-sales-officer": /^(?!.*\b(software|engineer|developer|data|it|credit|underwrit\w*|collections?)\b)((senior|sr\.?|junior|jr\.?|assistant|deputy|associate|field) )*((home loans?|housing (loans?|finance)|mortgage|loan against property) (sales (officer|executive)|officer|executive|counsell?or|advisor|relationship officer)|(sales|relationship) (officer|executive)\b.*\b(home loans?|housing (loans?|finance)|mortgages?|loan against property|lap))\b/i,
  // E-commerce and marketplace category managers; a plain, FMCG or procurement "Category Manager" has no rule.
  "category-manager-ecommerce": /^(?!.*\b(procurement|sourcing|purchase|purchasing|indirect|software|engineer|developer|data)\b)(((senior|sr\.?|assistant|associate|deputy|seller) )*category (manager|executive|lead|specialist|associate)\b.*\b(e-?commerce|marketplace|quick commerce|q-?commerce|online)\b|((senior|sr\.?|assistant|associate|deputy) )*((e-?commerce|marketplace|quick commerce|online) category|seller category) (manager|executive|lead|specialist)\b)/i,
  // Market and consumer research analysts; a plain or quantitative "Research Analyst", a UX researcher or an equity
  // researcher is not one.
  "market-research-analyst": /^(?!.*\b(data|software|engineer|developer|ux|user|equit(y|ies)|clinical)\b)((senior|sr\.?|junior|jr\.?|associate|assistant|lead|primary) )*((market|consumer|marketing) research (analyst|executive|associate|specialist)|((quantitative|qualitative) )?research (executive|analyst|associate)\b.*\b(market|consumer|primary) research)\b/i,
  // Event, exhibition and activation marketing executives, never a security event or event-driven software title.
  "event-marketing-executive": /^(?!.*\b(software|engineer|developer|data|it|security|siem)\b)((senior|sr\.?|junior|jr\.?|associate|assistant|dealer|corporate) )*((events?( (and|&) (field |experiential )?marketing)?|event marketing|trade shows?|exhibitions?|brand activations?|experiential marketing) (executive|specialist|coordinator|associate|officer))\b/i,
  // M&A, ECM and DCM analysts in investment banks and advisory boutiques, never a bank technology, risk or operations one.
  "investment-banking-analyst": /^(?!.*\b(technology|software|engineer|developer|data|it|operations|risk|compliance|kyc)\b)((senior|sr\.?|junior|jr\.?) )?((investment banking|m ?& ?a|mergers (and|&) acquisitions|ecm|dcm|equity capital markets|debt capital markets|deal execution) (analyst|associate)|analyst,? ?[-–]? ?(investment banking|m ?& ?a|mergers (and|&) acquisitions|ecm|dcm))\b/i,
  // Plant and product costing staff; a cloud cost (FinOps) analyst or a cost engineer is not one.
  "cost-accountant": /^(?!.*\b(cloud|finops|it|software|engineer|developer|data|aws|azure)\b)((senior|sr\.?|junior|jr\.?|assistant|associate|deputy|plant|factory|product|manufacturing) )*(cost accountant|costing (executive|officer|analyst|accountant|associate|manager|lead)|cost (controller|analyst)\b.*\b(manufacturing|plant|factory|production)|executive,? ?[-–]? ?costing)\b/i,
  // Office admin and facilities executives, never a system, database or network administrator; an "HR & Admin
  // Executive" stays HR generalist (above).
  "admin-facilities-executive": /^(?!.*\b(it|software|engineer|developer|data|systems?|database|network|sap)\b)((senior|sr\.?|junior|jr\.?|assistant|deputy|office) )*(((admin(istration)?|facilit(y|ies)|travel desk)( (and|&) (admin(istration)?|facilit(y|ies)|travel))?) (executive|officer|coordinator)|executive,? ?[-–]? ?(admin(istration)?|facilit(y|ies))( (and|&) (admin(istration)?|facilit(y|ies)))?)\b/i,
  // Contact centre team leaders, never a software, technical support or QA team lead.
  "customer-service-team-leader": /^(?!.*\b(software|engineer|developer|data|it|technical|qa|testing)\b)((senior|sr\.?|assistant|deputy) )*((customer (service|support|care|experience)|contact cent(re|er)|call cent(re|er)|voice process|chat process|bpo) team lead(er)?|team lead(er)?,? ?[-–]? ?((inbound|outbound|international|domestic) )*(customer (service|support|care|experience)|contact cent(re|er)|call cent(re|er)|voice|chat|email|non-voice|blended)( process| support)?)\b/i,
  // Factory quality inspectors; a quality engineer stays with the test rules, and a food safety or building inspector
  // is not one.
  "quality-control-inspector": /^(?!.*\b(software|engineer|developer|data|food safety|building|tax|police)\b)((senior|sr\.?|junior|jr\.?|trainee|assistant|incoming|in-process|line|final|shift|receiving) )*((quality( control| assurance)?|qc|qa|iqc|ipqc|pdi|final inspection|incoming inspection|in-process inspection|dimensional|machining) inspector)\b/i,
  // Batch F1 (also FMCG sales officers, above). Bank probationary officers and their scale I programmes, before
  // management trainee so a public sector bank's management trainee reads here; a purchase order ("PO") title is not one.
  "bank-probationary-officer": /^(?!.*\b(software|developer|engineer|data|it)\b)(((assistant|deputy) manager,? ?[-–]? ?)?((bank|sbi|ibps) )?probationary officers?\b|(bank|sbi|ibps) po\b|((assistant|deputy) manager|management trainee),? ?[-–]? ?(young bankers?|public sector bank|psu bank)\b|scale[- ](i|1) officer\b)/i,
  // Management trainees on a rotation programme, never an engineering, technical or bank one.
  "management-trainee": /^(?!.*\b(software|developer|engineer|engineering|technical|it|data|mechanical|electrical|civil|production|bank|banking|probationary)\b)((graduate|corporate) )*(management trainee|executive trainee|leadership (development )?(programme|program) trainee)\b/i,
  // CA article assistants and articleship trainees, never an article writer or editor.
  "article-assistant-ca": /^(?!.*\b(writer|writing|content|editor|journal\w*|news)\b)((ca|audit|tax|senior|sr\.?|junior|jr\.?) )*(article(d|ship)? (assistant|trainee|clerk|student)|articleship\b|ca article)\b/i,
  // Back-office and non-voice processing executives in banks, insurers and BPOs, never a team leader or a voice process
  // one; a plain "Operations Executive" has no rule.
  "back-office-executive": /^(?!.*\b(software|developer|engineer|it|sap|(?<!non[- ])voice|team lead(er)?|manager|analyst)\b)((senior|sr\.?|junior|jr\.?|trainee) )*((back[- ]office|banking operations|bank operations|policy issuance|data verification|non-voice( process)?) (executive|associate|assistant|officer|processor)|(operations|process) associate,? ?[-–]? ?(back[- ]office|non-voice|banking))\b/i,
};
const MANAGER_OK = new Set(["product-manager", "it-service-delivery-manager", "digital-marketing-executive", "grc-manager", "soc-lead", "engineering-manager", "scrum-master", "senior-data-scientist", "technical-program-manager", "it-project-manager", "technical-account-manager", "implementation-consultant", "ai-product-manager", "customer-success-manager", "product-marketing-manager", "key-account-manager", "area-sales-manager", "social-media-manager", "relationship-manager-banking", "collections-officer", "seo-specialist", "channel-sales-manager", "brand-manager", "retail-store-manager", "real-estate-sales-executive", "category-manager-ecommerce", "cost-accountant", "bank-probationary-officer"]);
/** The business rules that may read a sales or recruiting title, which NOT_IN_SCOPE drops for every other rule. */
const SALES_OK = new Set(["key-account-manager", "area-sales-manager", "inside-sales-executive", "talent-acquisition-specialist", "business-development-executive", "medical-representative", "channel-sales-manager", "real-estate-sales-executive", "home-loan-sales-officer", "fmcg-sales-officer", "management-trainee"]);
/** A location in India (moved from mine.mjs). Remote posts count only when they say India too. */
export const INDIA = /\b(india|bengaluru|bangalore|mumbai|pune|hyderabad|chennai|gurgaon|gurugram|noida|delhi|new delhi|kolkata|ahmedabad|jaipur|kochi)\b/i;
const NOT_SOFTWARE = /\b(hardware|manufacturing|supplier|mechanical|electrical|silicon|asic|firmware|validation)\b/i;
const TEST_ROLES = new Set(["qa-automation-engineer", "manual-test-engineer", "performance-test-engineer", "qa-lead"]);

/** The live role a title reads as, or null. `text` only settles Java for a backend title. */
export function classify(/** @type {string} */ title, /** @type {string} */ text = "") {
  // A pre-sales architect, engineer or consultant designs and demos solutions: "sales" in it is not a sales title.
  // SAP's Sales and Distribution module and SuccessFactors Recruiting are modules, not sales or recruiting jobs.
  const unsold = title
    .replace(/\bpre-?sales (?=((solutions?|technical|cloud) )?(architect|engineer|consultant|specialist|lead)\b)/i, "")
    .replace(/\b(technical|cloud) pre-?sales\b/i, "")
    .replace(/\bsales (and|&) distribution\b/i, (m) => (/\bsap\b/i.test(title) ? "" : m))
    .replace(/\b(successfactors|sap sf) (recruiting|recruitment)\b/i, "$1");
  if (SENIOR.test(title) && !SENIOR_TITLES.test(title)) return null;
  // A sales, recruiting or legal title reads only as a business rule built for it ("Sales Engineer" stays null).
  const outOfScope = NOT_IN_SCOPE.test(unsold);
  for (const [slug, re] of Object.entries(ROLE_TITLES)) {
    if (outOfScope && !SALES_OK.has(slug)) continue;
    if (!re.test(title)) continue;
    if (!MANAGER_OK.has(slug) && /\bmanager\b/i.test(title)) continue;
    if (TEST_ROLES.has(slug) && NOT_SOFTWARE.test(title)) continue;
    if (slug === "java-backend-developer" && !/\bjava\b/i.test(title + " " + text) && !/\b(spring|j2ee)\b/i.test(title)) continue;
    return slug;
  }
  return null;
}

/* Text ------------------------------------------------------------------------------------------------------------- */

export const decode = (/** @type {string} */ s) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
/** HTML (often escaped twice, as Greenhouse sends it) as one line of plain text. */
export const plain = (/** @type {string | null | undefined} */ html) => decode(decode(html ?? "")).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
export const norm = (/** @type {string} */ s) => s.toLowerCase().replace(/\s+/g, " ").trim();
export const escape = (/** @type {string} */ s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const BLOCK = /<\/?(p|div|br|li|ul|ol|h[1-6]|tr|section|header|strong|b)\b[^>]*>/gi;
/** HTML as lines, one per paragraph, list item or heading, so headings can be told apart from the text under them. */
export function htmlLines(/** @type {string | null | undefined} */ html) {
  return decode(decode(html ?? ""))
    .replace(BLOCK, "\n")
    .replace(/<[^>]+>/g, " ")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}
/** Plain text as lines. */
export const textLines = (/** @type {string | null | undefined} */ s) =>
  (s ?? "")
    .split(/\r?\n|•/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);

/* Skills, from the taxonomy (moved from mine.mjs) -------------------------------------------------------------- */

// Names that are also plain English words ("excel at", "go to") are matched case-sensitively.
const CASE_SENSITIVE_NAMES = new Set(["excel", "go"]);

/**
 * One matcher per skill over its name and aliases, case-insensitive, whole words only.
 * @param {{ id: string; name: string; aliases: string[] }[]} skills
 * @returns {SkillMatcher[]}
 */
export function skillMatchersFor(skills) {
  return skills.map((s) => {
    const aliases = [...new Set(s.aliases.map(norm))].filter((t) => t.length > 1);
    const bound = (/** @type {string} */ body, /** @type {string} */ flags) => new RegExp(`(?<![A-Za-z0-9])(${body})(?![A-Za-z0-9])`, flags);
    return {
      id: s.id,
      name: bound(escape(s.name), CASE_SENSITIVE_NAMES.has(s.id) ? "" : "i"),
      aliases: aliases.length ? bound(aliases.map(escape).join("|"), "i") : null,
    };
  });
}
export const hasSkill = (/** @type {SkillMatcher} */ m, /** @type {string} */ text) => m.name.test(text) || (m.aliases?.test(text) ?? false);

// A heading line: short, and nothing but the heading words (a trailing colon or a few words more is fine). A
// requirement such as "Strong SQL skills" doesn't start with these words, so it is never taken for one.
const NICE_HEADING = /^(nice[- ]to[- ]haves?|good[- ]to[- ]haves?|preferred|bonus|desirable|it'?s a plus|extra credit|plus points)\b.{0,40}$/i;
const REQUIRED_HEADING =
  /^(requirements?|minimum qualifications|basic qualifications|qualifications|what you('|’)?ll need|what you need|what we('|’)?re looking for|what you bring|must[- ]haves?|required skills|key skills|skills (and|&) experience|who you are|about you)\b.{0,40}$/i;
const OTHER_HEADING =
  /^(about (us|the (role|team|company|job))|responsibilities|key responsibilities|what you('|’)?ll do|what you will do|your role|the role|role overview|job description|benefits|perks|why join|what we offer|who we are|our team|location|compensation|salary|equal opportunity|how to apply)\b.{0,40}$/i;

/**
 * The skills a post names, split as the plan says: under a requirements-style heading they are required, under "Nice
 * to have", "Preferred" or "Bonus" nice to have. With no such heading, every skill found counts as required. A skill
 * in both lists is required. In the order of the taxonomy.
 * @param {string[]} lines
 * @param {SkillMatcher[]} matchers
 * @returns {{ required: string[]; nice: string[] }}
 */
export function skillsOf(lines, matchers) {
  /** @type {Record<"none" | "required" | "nice" | "other", string[]>} */
  const parts = { none: [], required: [], nice: [], other: [] };
  /** @type {"none" | "required" | "nice" | "other"} */
  let section = "none";
  let headed = false;
  for (const raw of lines) {
    const line = raw.replace(/[:：\s]+$/, "");
    if (line.length <= 80) {
      if (NICE_HEADING.test(line)) {
        section = "nice";
        headed = true;
      } else if (REQUIRED_HEADING.test(line)) {
        section = "required";
        headed = true;
      } else if (OTHER_HEADING.test(line)) section = "other";
    }
    parts[section].push(raw);
  }
  const found = (/** @type {string[]} */ ls) => {
    const text = ls.join("\n");
    return text ? matchers.filter((m) => hasSkill(m, text)).map((m) => m.id) : [];
  };
  const required = headed ? found(parts.required) : found([...parts.none, ...parts.required, ...parts.other]);
  const must = new Set(required);
  const nice = headed ? found(parts.nice).filter((id) => !must.has(id)) : [];
  return { required: required.slice(0, FEED_LIMITS.skills), nice: nice.slice(0, FEED_LIMITS.skills) };
}

/* Postings, from each board's answer ----------------------------------------------------------------------------- */

const date = (/** @type {string | number | null | undefined} */ v) => {
  if (v === null || v === undefined || v === "") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Work type from the board's own words: part time, contract or freelance, else full time. */
export function workTypeOf(/** @type {string | null | undefined} */ words) {
  const w = (words ?? "").toLowerCase().replace(/[\s_-]+/g, "");
  if (w.includes("parttime")) return /** @type {FeedWorkType} */ ("part_time");
  if (/contract|freelance|temporary|consultant/.test(w)) return /** @type {FeedWorkType} */ ("freelance");
  return /** @type {FeedWorkType} */ ("full_time");
}

const REMOTE = /\b(remote|work from home|wfh|anywhere)\b/i;

/**
 * One posting of a board's answer, already checked by its Zod schema (feed-schemas.mjs), as a RawPost.
 * @param {Ats} ats
 * @param {any} j
 * @param {string} token
 * @returns {RawPost}
 */
export function rawPost(ats, j, token) {
  if (ats === "greenhouse") {
    const location = j.location?.name ?? "";
    return {
      externalId: j.id,
      title: plain(j.title),
      url: j.absolute_url,
      location,
      remote: REMOTE.test(location),
      workType: "full_time",
      postedAt: date(j.first_published) ?? date(j.updated_at),
      lines: htmlLines(j.content),
    };
  }
  if (ats === "lever") {
    const location = [j.categories?.location, ...(j.categories?.allLocations ?? [])].filter(Boolean).join(", ");
    return {
      externalId: j.id,
      title: plain(j.text),
      url: j.hostedUrl,
      location,
      remote: REMOTE.test(location) || /remote/i.test(j.workplaceType ?? ""),
      workType: workTypeOf(j.categories?.commitment),
      postedAt: date(j.createdAt),
      lines: [...textLines(j.descriptionPlain), ...(j.lists ?? []).flatMap((/** @type {any} */ l) => [plain(l.text), ...htmlLines(l.content)]), ...textLines(j.additionalPlain)],
    };
  }
  if (ats === "ashby") {
    const location = [j.location, ...(j.secondaryLocations ?? []).map((/** @type {any} */ l) => l.location)].filter(Boolean).join(", ");
    return {
      externalId: j.id,
      title: plain(j.title),
      url: j.jobUrl,
      location,
      remote: Boolean(j.isRemote) || REMOTE.test(location),
      workType: workTypeOf(j.employmentType),
      postedAt: date(j.publishedAt),
      lines: j.descriptionHtml ? htmlLines(j.descriptionHtml) : textLines(j.descriptionPlain),
    };
  }
  // SmartRecruiters' list answer has no description (one GET per board), so its posts name only the title's skills.
  const loc = j.location ?? {};
  const location = [loc.fullLocation, loc.city, loc.region, loc.country === "in" || loc.country === "IN" ? "India" : loc.country].filter(Boolean).join(", ");
  return {
    externalId: j.id,
    title: plain(j.name),
    url: `https://jobs.smartrecruiters.com/${encodeURIComponent(j.company?.identifier ?? token)}/${encodeURIComponent(j.id)}`,
    location,
    remote: Boolean(loc.remote) || REMOTE.test(location),
    workType: workTypeOf(j.typeOfEmployment?.label),
    postedAt: date(j.releasedDate),
    lines: [],
  };
}

const RANGE = /(?<![\d.])(\d{1,2}) ?(?:-|–|—|to) ?(\d{1,2}) ?(?:\+ ?)?(?:years?|yrs?)\b/gi;
const SINGLE = /(?<![\d.\-–—]|[\-–—] |to )(\d{1,2}) ?(\+|plus)? ?(?:years?|yrs?)\b/gi;
const EXPERIENCE = /experience|\bexp\b|working|industry|hands-on|professional|background|relevant/i;

/**
 * The experience a post states, as the row shows it: "2 to 4 years" or "5+ years", from the highest stated minimum,
 * as /market's band reads it (experienceBand, which also skips company blurbs such as "founded 30 years ago"). Null
 * when the post states no years: never guessed from the title.
 */
export function experienceNoteOf(/** @type {string} */ raw) {
  if (!experienceBand(raw)) return null;
  const text = raw.replace(/\s+/g, " ");
  const near = (/** @type {RegExpMatchArray} */ m) => EXPERIENCE.test(text.slice(Math.max(0, (m.index ?? 0) - 40), (m.index ?? 0) + m[0].length + 60));
  /** @type {{ min: number; max: number | null } | null} */
  let best = null;
  for (const m of text.matchAll(RANGE)) {
    const min = Number(m[1]);
    const max = Number(m[2]);
    if (min <= 15 && max > min && max <= 20 && near(m) && (!best || min > best.min)) best = { min, max };
  }
  for (const m of text.matchAll(SINGLE)) {
    const min = Number(m[1]);
    if (min >= 1 && min <= 15 && near(m) && (!best || min > best.min)) best = { min, max: null };
  }
  if (!best) return null;
  return best.max === null ? `${best.min}+ years` : `${best.min} to ${best.max} years`;
}

/** The place a row shows: "Remote" for a remote India post, else the first Indian city named, else "India". */
export function cityOf(/** @type {string} */ location, /** @type {boolean} */ remote) {
  if (remote) return "Remote";
  return placesOf(location).find((p) => p.city)?.city ?? "India";
}

/** How far ahead of the fetch a posted time may be and still count, as clock skew: it is then the fetch time. */
export const FUTURE_SKEW_MS = 10 * 60 * 1000;

/**
 * A board's posted time as the feed keeps it (T90): a time more than a few minutes after the fetch is wrong, so it
 * is null (unknown) and can't sort to the top of Departures and Today or always survive the caps; one a few minutes
 * ahead is clock skew and becomes the fetch time. Null rather than the fetch time, because a post that stays dated
 * ahead would otherwise be "posted now" again on every run.
 * @param {Date | null} postedAt
 * @param {Date} now the fetch time
 * @returns {Date | null}
 */
export function postedAtOf(postedAt, now) {
  if (!postedAt || postedAt.getTime() <= now.getTime()) return postedAt;
  return postedAt.getTime() - now.getTime() <= FUTURE_SKEW_MS ? new Date(now.getTime()) : null;
}

/**
 * The job_posts row for one posting, or null when the rules leave it out: not in India (a remote post must say
 * India), not an https link, or a title too short to show. Not yet checked by `jobPostRow`; the feed does that.
 * @param {Ats} ats
 * @param {{ token: string; company: string }} board
 * @param {RawPost} post
 * @param {SkillMatcher[]} matchers
 * @param {Date} [now] the fetch time, for a posted time dated ahead of it (postedAtOf)
 */
export function postRow(ats, board, post, matchers, now = new Date()) {
  if (!INDIA.test(post.location) && !placesOf(post.location).length) return null;
  if (!/^https:\/\/[^\s"<>]+$/.test(post.url ?? "") || post.url.length > 500) return null;
  const title = post.title.length > 160 ? `${post.title.slice(0, 159).trimEnd()}…` : post.title;
  if (title.length < 2) return null;
  const text = post.lines.join("\n");
  const skills = skillsOf(post.lines.length ? post.lines : [post.title], matchers);
  return {
    ats,
    boardToken: board.token,
    externalId: String(post.externalId).slice(0, 120),
    url: post.url,
    title,
    company: board.company,
    city: cityOf(post.location, post.remote),
    workType: post.workType,
    experienceNote: experienceNoteOf(text),
    roleSlug: classify(title, text),
    requiredSkillIds: skills.required,
    niceSkillIds: skills.nice,
    postedAt: postedAtOf(post.postedAt, now),
  };
}

/**
 * The caps: at most `perBoard` posts a board and `total` in all, the newest kept (by posted time, then id).
 * @template {{ boardToken: string; ats: string; externalId: string; postedAt: Date | null }} T
 * @param {T[]} rows
 * @returns {T[]}
 */
export function capPosts(rows, perBoard = FEED_LIMITS.postsPerBoard, total = FEED_LIMITS.openPosts) {
  const newest = [...rows].sort((a, b) => (b.postedAt?.getTime() ?? 0) - (a.postedAt?.getTime() ?? 0) || a.externalId.localeCompare(b.externalId));
  /** @type {Map<string, number>} */
  const perKey = new Map();
  const kept = [];
  for (const r of newest) {
    const key = `${r.ats}:${r.boardToken}`;
    const n = perKey.get(key) ?? 0;
    if (n >= perBoard) continue;
    perKey.set(key, n + 1);
    kept.push(r);
    if (kept.length >= total) break;
  }
  return kept;
}
