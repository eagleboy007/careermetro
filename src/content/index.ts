import { z } from "zod";
import {
  certification,
  eliteShelfFile,
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
import eliteShelfJson from "./elite-shelf.json";
import mockBankJson from "./mock-bank.json";
import practiceQuestionsJson from "./practice-questions.json";
import proofTasksJson from "./proof-tasks.json";
import resourcesJson from "./resources.json";
import roleTracksJson from "./role-tracks.json";
import skillsJson from "./skills.json";
import aiEngineer from "./roles/ai-engineer.json";
import androidDeveloper from "./roles/android-developer.json";
import appsecEngineer from "./roles/appsec-engineer.json";
import biDeveloper from "./roles/bi-developer.json";
import businessAnalyst from "./roles/business-analyst.json";
import cloudArchitect from "./roles/cloud-architect.json";
import cloudEngineer from "./roles/cloud-engineer.json";
import cloudSecurityEngineer from "./roles/cloud-security-engineer.json";
import crossPlatformMobileDeveloper from "./roles/cross-platform-mobile-developer.json";
import cyberSecurityAnalyst from "./roles/cyber-security-analyst.json";
import dataAnalyst from "./roles/data-analyst.json";
import dataArchitect from "./roles/data-architect.json";
import dataEngineer from "./roles/data-engineer.json";
import dataScientist from "./roles/data-scientist.json";
import databaseAdministrator from "./roles/database-administrator.json";
import databaseArchitect from "./roles/database-architect.json";
import devopsEngineer from "./roles/devops-engineer.json";
import digitalMarketingExecutive from "./roles/digital-marketing-executive.json";
import dotnetDeveloper from "./roles/dotnet-developer.json";
import embeddedSoftwareEngineer from "./roles/embedded-software-engineer.json";
import engineeringManager from "./roles/engineering-manager.json";
import frontendDeveloper from "./roles/frontend-developer.json";
import fullStackDeveloper from "./roles/full-stack-developer.json";
import grcManager from "./roles/grc-manager.json";
import iamEngineer from "./roles/iam-engineer.json";
import incidentResponseAnalyst from "./roles/incident-response-analyst.json";
import informationSecurityAnalyst from "./roles/information-security-analyst.json";
import iosDeveloper from "./roles/ios-developer.json";
import itSupportEngineer from "./roles/it-support-engineer.json";
import javaBackendDeveloper from "./roles/java-backend-developer.json";
import manualTestEngineer from "./roles/manual-test-engineer.json";
import mlEngineer from "./roles/ml-engineer.json";
import mlopsEngineer from "./roles/mlops-engineer.json";
import networkEngineer from "./roles/network-engineer.json";
import nodejsDeveloper from "./roles/nodejs-developer.json";
import penetrationTester from "./roles/penetration-tester.json";
import performanceTestEngineer from "./roles/performance-test-engineer.json";
import platformEngineer from "./roles/platform-engineer.json";
import privacyAnalyst from "./roles/privacy-analyst.json";
import productManager from "./roles/product-manager.json";
import pythonDeveloper from "./roles/python-developer.json";
import qaAutomationEngineer from "./roles/qa-automation-engineer.json";
import salesforceDeveloper from "./roles/salesforce-developer.json";
import sapAbapDeveloper from "./roles/sap-abap-developer.json";
import scrumMaster from "./roles/scrum-master.json";
import securityArchitect from "./roles/security-architect.json";
import seniorBackendEngineer from "./roles/senior-backend-engineer.json";
import seniorDataScientist from "./roles/senior-data-scientist.json";
import servicenowDeveloper from "./roles/servicenow-developer.json";
import siteReliabilityEngineer from "./roles/site-reliability-engineer.json";
import socAnalystL2 from "./roles/soc-analyst-l2.json";
import socLead from "./roles/soc-lead.json";
import softwareEngineer from "./roles/software-engineer.json";
import solutionsArchitect from "./roles/solutions-architect.json";
import systemAdministrator from "./roles/system-administrator.json";
import technicalSupportEngineer from "./roles/technical-support-engineer.json";
import technicalWriter from "./roles/technical-writer.json";
import threatIntelligenceAnalyst from "./roles/threat-intelligence-analyst.json";
import uiUxDesigner from "./roles/ui-ux-designer.json";
import vulnerabilityManagementAnalyst from "./roles/vulnerability-management-analyst.json";

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

/** Hand-built role profiles (FR-8, FR-9). Unpublished until a domain expert sets reviewedBy. */
export const roleProfiles: RoleProfile[] = z
  .array(roleProfile)
  .parse([
    aiEngineer,
    androidDeveloper,
    appsecEngineer,
    biDeveloper,
    businessAnalyst,
    cloudArchitect,
    cloudEngineer,
    cloudSecurityEngineer,
    crossPlatformMobileDeveloper,
    cyberSecurityAnalyst,
    dataAnalyst,
    dataArchitect,
    dataEngineer,
    dataScientist,
    databaseAdministrator,
    databaseArchitect,
    devopsEngineer,
    digitalMarketingExecutive,
    dotnetDeveloper,
    embeddedSoftwareEngineer,
    engineeringManager,
    frontendDeveloper,
    fullStackDeveloper,
    grcManager,
    iamEngineer,
    incidentResponseAnalyst,
    informationSecurityAnalyst,
    iosDeveloper,
    itSupportEngineer,
    javaBackendDeveloper,
    manualTestEngineer,
    mlEngineer,
    mlopsEngineer,
    networkEngineer,
    nodejsDeveloper,
    penetrationTester,
    performanceTestEngineer,
    platformEngineer,
    privacyAnalyst,
    productManager,
    pythonDeveloper,
    qaAutomationEngineer,
    salesforceDeveloper,
    sapAbapDeveloper,
    scrumMaster,
    securityArchitect,
    seniorBackendEngineer,
    seniorDataScientist,
    servicenowDeveloper,
    siteReliabilityEngineer,
    socAnalystL2,
    socLead,
    softwareEngineer,
    solutionsArchitect,
    systemAdministrator,
    technicalSupportEngineer,
    technicalWriter,
    threatIntelligenceAnalyst,
    uiUxDesigner,
    vulnerabilityManagementAnalyst,
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
