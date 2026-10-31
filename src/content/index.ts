import { z } from "zod";
import {
  certification,
  cityCentresFile,
  eventFeedsFile,
  eliteShelfFile,
  interestTopicsFile,
  mockBankFile,
  practiceQuestion,
  proofTask,
  resource,
  roleProfile,
  roleTrackProblems,
  roleTracksFile,
  skillGroups,
  skill,
  type Certification,
  type CityCentre,
  type EventFeed,
  type InterestTopic,
  type ShelfEntry,
  type MockQuestion,
  type PracticeQuestion,
  type ProofTask,
  type Resource,
  type RoleProfile,
  type RoleTracks,
  type Skill,
} from "@/lib/schemas";
import certificationsJson from "./certifications.json";
import cityCentresJson from "./city-centres.json";
import eventFeedsJson from "./event-feeds.json";
import interestTopicsJson from "./interest-topics.json";
import eliteShelfJson from "./elite-shelf.json";
import mockBankJson from "./mock-bank.json";
import practiceQuestionsJson from "./practice-questions.json";
import proofTasksJson from "./proof-tasks.json";
import resourcesJson from "./resources.json";
import roleTracksJson from "./role-tracks.json";
import skillsJson from "./skills.json";
import accountsExecutive from "./roles/accounts-executive.json";
import adasEngineer from "./roles/adas-engineer.json";
import aiArchitect from "./roles/ai-architect.json";
import aiEngineer from "./roles/ai-engineer.json";
import aiProductManager from "./roles/ai-product-manager.json";
import aiResearchScientist from "./roles/ai-research-scientist.json";
import amlKycAnalyst from "./roles/aml-kyc-analyst.json";
import analyticsEngineer from "./roles/analytics-engineer.json";
import androidDeveloper from "./roles/android-developer.json";
import applicationSupportEngineer from "./roles/application-support-engineer.json";
import appsecEngineer from "./roles/appsec-engineer.json";
import arVrDeveloper from "./roles/ar-vr-developer.json";
import areaSalesManager from "./roles/area-sales-manager.json";
import automotiveDiagnosticsEngineer from "./roles/automotive-diagnostics-engineer.json";
import autosarEngineer from "./roles/autosar-engineer.json";
import biDeveloper from "./roles/bi-developer.json";
import blockchainDeveloper from "./roles/blockchain-developer.json";
import buildReleaseEngineer from "./roles/build-release-engineer.json";
import businessAnalyst from "./roles/business-analyst.json";
import cloudArchitect from "./roles/cloud-architect.json";
import cloudEngineer from "./roles/cloud-engineer.json";
import cloudFinopsAnalyst from "./roles/cloud-finops-analyst.json";
import cloudNetworkEngineer from "./roles/cloud-network-engineer.json";
import cloudSecurityEngineer from "./roles/cloud-security-engineer.json";
import cloudSupportEngineer from "./roles/cloud-support-engineer.json";
import computerVisionEngineer from "./roles/computer-vision-engineer.json";
import contactCenterDeveloper from "./roles/contact-center-developer.json";
import cppDeveloper from "./roles/cpp-developer.json";
import creditRiskAnalyst from "./roles/credit-risk-analyst.json";
import crossPlatformMobileDeveloper from "./roles/cross-platform-mobile-developer.json";
import customerSuccessManager from "./roles/customer-success-manager.json";
import customerSupportExecutive from "./roles/customer-support-executive.json";
import cyberSecurityAnalyst from "./roles/cyber-security-analyst.json";
import dataAnalyst from "./roles/data-analyst.json";
import dataArchitect from "./roles/data-architect.json";
import dataCenterEngineer from "./roles/data-center-engineer.json";
import dataEngineer from "./roles/data-engineer.json";
import dataGovernanceAnalyst from "./roles/data-governance-analyst.json";
import dataQualityEngineer from "./roles/data-quality-engineer.json";
import dataScientist from "./roles/data-scientist.json";
import databaseAdministrator from "./roles/database-administrator.json";
import databaseArchitect from "./roles/database-architect.json";
import databaseDeveloper from "./roles/database-developer.json";
import developerAdvocate from "./roles/developer-advocate.json";
import devopsEngineer from "./roles/devops-engineer.json";
import devsecopsEngineer from "./roles/devsecops-engineer.json";
import digitalForensicsAnalyst from "./roles/digital-forensics-analyst.json";
import digitalMarketingExecutive from "./roles/digital-marketing-executive.json";
import dlpEngineer from "./roles/dlp-engineer.json";
import dotnetDeveloper from "./roles/dotnet-developer.json";
import dynamics365Developer from "./roles/dynamics-365-developer.json";
import ecommerceDeveloper from "./roles/ecommerce-developer.json";
import embeddedSoftwareEngineer from "./roles/embedded-software-engineer.json";
import engineeringManager from "./roles/engineering-manager.json";
import etlDeveloper from "./roles/etl-developer.json";
import eucEngineer from "./roles/euc-engineer.json";
import financialAnalyst from "./roles/financial-analyst.json";
import forwardDeployedEngineer from "./roles/forward-deployed-engineer.json";
import fpgaEngineer from "./roles/fpga-engineer.json";
import frontendArchitect from "./roles/frontend-architect.json";
import frontendDeveloper from "./roles/frontend-developer.json";
import fullStackDeveloper from "./roles/full-stack-developer.json";
import gameDeveloper from "./roles/game-developer.json";
import gisDeveloper from "./roles/gis-developer.json";
import golangDeveloper from "./roles/golang-developer.json";
import grcManager from "./roles/grc-manager.json";
import hardwareDesignEngineer from "./roles/hardware-design-engineer.json";
import hilTestEngineer from "./roles/hil-test-engineer.json";
import hpcGpuEngineer from "./roles/hpc-gpu-engineer.json";
import hrGeneralist from "./roles/hr-generalist.json";
import iamEngineer from "./roles/iam-engineer.json";
import implementationConsultant from "./roles/implementation-consultant.json";
import incidentResponseAnalyst from "./roles/incident-response-analyst.json";
import informationSecurityAnalyst from "./roles/information-security-analyst.json";
import insideSalesExecutive from "./roles/inside-sales-executive.json";
import integrationDeveloper from "./roles/integration-developer.json";
import iosDeveloper from "./roles/ios-developer.json";
import iotEngineer from "./roles/iot-engineer.json";
import itAuditor from "./roles/it-auditor.json";
import itProjectManager from "./roles/it-project-manager.json";
import itSupportEngineer from "./roles/it-support-engineer.json";
import javaBackendDeveloper from "./roles/java-backend-developer.json";
import kafkaStreamingEngineer from "./roles/kafka-streaming-engineer.json";
import keyAccountManager from "./roles/key-account-manager.json";
import linuxKernelDeveloper from "./roles/linux-kernel-developer.json";
import lowCodeDeveloper from "./roles/low-code-developer.json";
import m365Administrator from "./roles/m365-administrator.json";
import mainframeDeveloper from "./roles/mainframe-developer.json";
import malwareAnalyst from "./roles/malware-analyst.json";
import manualTestEngineer from "./roles/manual-test-engineer.json";
import mlEngineer from "./roles/ml-engineer.json";
import mlopsEngineer from "./roles/mlops-engineer.json";
import networkEngineer from "./roles/network-engineer.json";
import networkSecurityEngineer from "./roles/network-security-engineer.json";
import nlpEngineer from "./roles/nlp-engineer.json";
import nocEngineer from "./roles/noc-engineer.json";
import nodejsDeveloper from "./roles/nodejs-developer.json";
import oracleEbsConsultant from "./roles/oracle-ebs-consultant.json";
import oracleFusionTechnicalConsultant from "./roles/oracle-fusion-technical-consultant.json";
import otSecurityEngineer from "./roles/ot-security-engineer.json";
import pamEngineer from "./roles/pam-engineer.json";
import pegaDeveloper from "./roles/pega-developer.json";
import penetrationTester from "./roles/penetration-tester.json";
import performanceTestEngineer from "./roles/performance-test-engineer.json";
import phpDeveloper from "./roles/php-developer.json";
import platformEngineer from "./roles/platform-engineer.json";
import plcScadaEngineer from "./roles/plc-scada-engineer.json";
import plmDeveloper from "./roles/plm-developer.json";
import postSiliconValidationEngineer from "./roles/post-silicon-validation-engineer.json";
import powerPlatformDeveloper from "./roles/power-platform-developer.json";
import presalesEngineer from "./roles/presales-engineer.json";
import privacyAnalyst from "./roles/privacy-analyst.json";
import productManager from "./roles/product-manager.json";
import productMarketingManager from "./roles/product-marketing-manager.json";
import pythonDeveloper from "./roles/python-developer.json";
import qaAutomationEngineer from "./roles/qa-automation-engineer.json";
import qaLead from "./roles/qa-lead.json";
import quantDeveloper from "./roles/quant-developer.json";
import redTeamOperator from "./roles/red-team-operator.json";
import roboticsEngineer from "./roles/robotics-engineer.json";
import rpaDeveloper from "./roles/rpa-developer.json";
import rubyOnRailsDeveloper from "./roles/ruby-on-rails-developer.json";
import rustDeveloper from "./roles/rust-developer.json";
import salesforceAdministrator from "./roles/salesforce-administrator.json";
import salesforceDeveloper from "./roles/salesforce-developer.json";
import sapAbapDeveloper from "./roles/sap-abap-developer.json";
import sapBasisAdministrator from "./roles/sap-basis-administrator.json";
import sapFicoConsultant from "./roles/sap-fico-consultant.json";
import sapMmConsultant from "./roles/sap-mm-consultant.json";
import sapPpConsultant from "./roles/sap-pp-consultant.json";
import sapSdConsultant from "./roles/sap-sd-consultant.json";
import sapSuccessfactorsConsultant from "./roles/sap-successfactors-consultant.json";
import scrumMaster from "./roles/scrum-master.json";
import searchEngineer from "./roles/search-engineer.json";
import securityArchitect from "./roles/security-architect.json";
import seniorBackendEngineer from "./roles/senior-backend-engineer.json";
import seniorDataScientist from "./roles/senior-data-scientist.json";
import servicenowAdministrator from "./roles/servicenow-administrator.json";
import servicenowDeveloper from "./roles/servicenow-developer.json";
import sharepointDeveloper from "./roles/sharepoint-developer.json";
import siemEngineer from "./roles/siem-engineer.json";
import siteReliabilityEngineer from "./roles/site-reliability-engineer.json";
import socAnalystL2 from "./roles/soc-analyst-l2.json";
import socLead from "./roles/soc-lead.json";
import softwareEngineer from "./roles/software-engineer.json";
import solutionsArchitect from "./roles/solutions-architect.json";
import storageBackupEngineer from "./roles/storage-backup-engineer.json";
import supplyChainAnalyst from "./roles/supply-chain-analyst.json";
import systemAdministrator from "./roles/system-administrator.json";
import talentAcquisitionSpecialist from "./roles/talent-acquisition-specialist.json";
import techLead from "./roles/tech-lead.json";
import technicalAccountManager from "./roles/technical-account-manager.json";
import technicalProgramManager from "./roles/technical-program-manager.json";
import technicalSupportEngineer from "./roles/technical-support-engineer.json";
import technicalWriter from "./roles/technical-writer.json";
import telecomRanEngineer from "./roles/telecom-ran-engineer.json";
import thirdPartyRiskAnalyst from "./roles/third-party-risk-analyst.json";
import threatIntelligenceAnalyst from "./roles/threat-intelligence-analyst.json";
import uiUxDesigner from "./roles/ui-ux-designer.json";
import unifiedCommunicationsEngineer from "./roles/unified-communications-engineer.json";
import uxResearcher from "./roles/ux-researcher.json";
import virtualizationEngineer from "./roles/virtualization-engineer.json";
import vlsiDesignEngineer from "./roles/vlsi-design-engineer.json";
import vulnerabilityManagementAnalyst from "./roles/vulnerability-management-analyst.json";
import workdayConsultant from "./roles/workday-consultant.json";

/** The skill taxonomy. Validated at import so a bad edit fails tests and the build. */
export const skills: Skill[] = z.array(skill).parse(skillsJson);

/** Certifications that role profiles can recommend. */
export const certifications: Certification[] = z.array(certification).parse(certificationsJson);

/** The reviewed resource catalog (FR-17). Seeded into the resources table; paths link only to these. */
export const resources: Resource[] = z.array(resource).parse(resourcesJson);

/** Fallback proof-of-skill tasks, one per skill, for when the model is not available. */
export const proofTasks: ProofTask[] = z.array(proofTask).parse(proofTasksJson);

/**
 * Practice questions (handoff 12h): 5 L1 questions per skill. 15 skills role profiles most often require come from
 * Data research's practice-questions-v1 (2026-10-15); 4 data-analyst skills (statistics, data cleaning, data
 * visualization, Excel) were added by Development so the most common target role has questions for its gaps. Content, never written by the model. v1 is self-checked only:
 * no expert has reviewed it yet, so it isn't called "reviewed" in the app. `lookFor` guides the person; nothing scores
 * an answer by matching its words.
 */
export const practiceQuestions: PracticeQuestion[] = z.array(practiceQuestion).parse(practiceQuestionsJson);

/**
 * The interview prep bank (`/mock`, FR-50, handoff 12l). Open questions are the Practice bank's, with "a strong answer
 * covers" taken from its `lookFor` (a test keeps them the same). Multiple-choice questions for the timed test were
 * hand-written by Development and carry `reviewed: false` until someone who works in the role checks them; production
 * uses only reviewed ones (src/lib/mock/rules.ts). Never written by the model.
 */
export const mockQuestions: MockQuestion[] = mockBankFile.parse(mockBankJson).questions;

/**
 * The Elite shelf (Library's Elite tab, FR-50 part 5, handoff 12l): free catalog sources by URL, playbooks and drills
 * hand-written by Development (`reviewed: false` until someone who works in the role checks them; production shows
 * only reviewed ones, src/lib/library/shelf.ts) and paid-course slots marked Coming soon. Never written by the model.
 */
export const eliteShelfEntries: ShelfEntry[] = eliteShelfFile.parse(eliteShelfJson).entries;

/**
 * Timetable (docs/plans/timetable-plan.md section 3): one centre point per city a person may give (PERSON_CITIES), from
 * public map data, to 4 decimals. Distance to an event is worked out between two city centres; nothing is geocoded.
 */
export const cityCentres: CityCentre[] = cityCentresFile.parse(cityCentresJson);

/**
 * Timetable (section 2): common interest topics, each with the words that mean it. An interest typed on Me maps to a
 * topic only when it is the topic's key, label or one of its aliases exactly; anything else matches nothing.
 */
export const interestTopics: InterestTopic[] = interestTopicsFile.parse(interestTopicsJson);

/**
 * Timetable PR 4 (section 6): the organisers' public feeds the daily event feed may read, each with its terms link and
 * the day its terms were read. A feed is read only while it is on, and it goes on only with that day.
 */
export const eventFeeds: EventFeed[] = eventFeedsFile.parse(eventFeedsJson);

/** Hand-built role profiles (FR-8, FR-9). Unpublished until a domain expert sets reviewedBy. */
export const roleProfiles: RoleProfile[] = z
  .array(roleProfile)
  .parse([
    accountsExecutive,
    adasEngineer,
    aiArchitect,
    aiEngineer,
    aiProductManager,
    aiResearchScientist,
    amlKycAnalyst,
    analyticsEngineer,
    androidDeveloper,
    applicationSupportEngineer,
    appsecEngineer,
    arVrDeveloper,
    areaSalesManager,
    automotiveDiagnosticsEngineer,
    autosarEngineer,
    biDeveloper,
    blockchainDeveloper,
    buildReleaseEngineer,
    businessAnalyst,
    cloudArchitect,
    cloudEngineer,
    cloudFinopsAnalyst,
    cloudNetworkEngineer,
    cloudSecurityEngineer,
    cloudSupportEngineer,
    computerVisionEngineer,
    contactCenterDeveloper,
    cppDeveloper,
    creditRiskAnalyst,
    crossPlatformMobileDeveloper,
    customerSuccessManager,
    customerSupportExecutive,
    cyberSecurityAnalyst,
    dataAnalyst,
    dataArchitect,
    dataCenterEngineer,
    dataEngineer,
    dataGovernanceAnalyst,
    dataQualityEngineer,
    dataScientist,
    databaseAdministrator,
    databaseArchitect,
    databaseDeveloper,
    developerAdvocate,
    devopsEngineer,
    devsecopsEngineer,
    digitalForensicsAnalyst,
    digitalMarketingExecutive,
    dlpEngineer,
    dotnetDeveloper,
    dynamics365Developer,
    ecommerceDeveloper,
    embeddedSoftwareEngineer,
    engineeringManager,
    etlDeveloper,
    eucEngineer,
    financialAnalyst,
    forwardDeployedEngineer,
    fpgaEngineer,
    frontendArchitect,
    frontendDeveloper,
    fullStackDeveloper,
    gameDeveloper,
    gisDeveloper,
    golangDeveloper,
    grcManager,
    hardwareDesignEngineer,
    hilTestEngineer,
    hpcGpuEngineer,
    hrGeneralist,
    iamEngineer,
    implementationConsultant,
    incidentResponseAnalyst,
    informationSecurityAnalyst,
    insideSalesExecutive,
    integrationDeveloper,
    iosDeveloper,
    iotEngineer,
    itAuditor,
    itProjectManager,
    itSupportEngineer,
    javaBackendDeveloper,
    kafkaStreamingEngineer,
    keyAccountManager,
    linuxKernelDeveloper,
    lowCodeDeveloper,
    m365Administrator,
    mainframeDeveloper,
    malwareAnalyst,
    manualTestEngineer,
    mlEngineer,
    mlopsEngineer,
    networkEngineer,
    networkSecurityEngineer,
    nlpEngineer,
    nocEngineer,
    nodejsDeveloper,
    oracleEbsConsultant,
    oracleFusionTechnicalConsultant,
    otSecurityEngineer,
    pamEngineer,
    pegaDeveloper,
    penetrationTester,
    performanceTestEngineer,
    phpDeveloper,
    platformEngineer,
    plcScadaEngineer,
    plmDeveloper,
    postSiliconValidationEngineer,
    powerPlatformDeveloper,
    presalesEngineer,
    privacyAnalyst,
    productManager,
    productMarketingManager,
    pythonDeveloper,
    qaAutomationEngineer,
    qaLead,
    quantDeveloper,
    redTeamOperator,
    roboticsEngineer,
    rpaDeveloper,
    rubyOnRailsDeveloper,
    rustDeveloper,
    salesforceAdministrator,
    salesforceDeveloper,
    sapAbapDeveloper,
    sapBasisAdministrator,
    sapFicoConsultant,
    sapMmConsultant,
    sapPpConsultant,
    sapSdConsultant,
    sapSuccessfactorsConsultant,
    scrumMaster,
    searchEngineer,
    securityArchitect,
    seniorBackendEngineer,
    seniorDataScientist,
    servicenowAdministrator,
    servicenowDeveloper,
    sharepointDeveloper,
    siemEngineer,
    siteReliabilityEngineer,
    socAnalystL2,
    socLead,
    softwareEngineer,
    solutionsArchitect,
    storageBackupEngineer,
    supplyChainAnalyst,
    systemAdministrator,
    talentAcquisitionSpecialist,
    techLead,
    technicalAccountManager,
    technicalProgramManager,
    technicalSupportEngineer,
    technicalWriter,
    telecomRanEngineer,
    thirdPartyRiskAnalyst,
    threatIntelligenceAnalyst,
    uiUxDesigner,
    unifiedCommunicationsEngineer,
    uxResearcher,
    virtualizationEngineer,
    vlsiDesignEngineer,
    vulnerabilityManagementAnalyst,
    workdayConsultant,
  ]);

export function normalizeSkillTerm(term: string): string {
  return term.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Maps a normalized name or alias to its skill id. Exact match only. */
export const skillIdByTerm: ReadonlyMap<string, string> = new Map(
  skills.flatMap((s) => [s.id, s.name, ...s.aliases].map((t) => [normalizeSkillTerm(t), s.id] as const)),
);

/**
 * Every "one of these" group's skills by group id. A group id means the same set in every role (a content test checks
 * it), so a goal can tell which proof fills it from its group id alone.
 */
export const skillGroupMembers: ReadonlyMap<string, string[]> = new Map(
  roleProfiles.flatMap((r) => skillGroups(r).map((g) => [g.id, g.skillIds] as const)),
);

/**
 * Role tracks (v44 gap list item 11, docs/plans/tracks-plan.md): up to five kinds of work per role, each an edit of
 * the role's own skill list. Hand-written by Development and `reviewed: false` until someone who works in the role
 * checks them; production offers only reviewed ones (src/lib/tracks/apply.ts). Checked against the role profiles and
 * the taxonomy at import, so a bad edit fails tests and the build. Never written by the model.
 */
export const roleTracks: RoleTracks[] = (() => {
  const file = roleTracksFile.parse(roleTracksJson);
  const problems = roleTrackProblems(file, roleProfiles, new Set(skills.map((s) => s.id)));
  if (problems.length) throw new Error(`src/content/role-tracks.json: ${problems.join("; ")}`);
  return file.roles;
})();
