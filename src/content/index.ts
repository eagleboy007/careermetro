import { z } from "zod";
import {
  certification,
  proofTask,
  resource,
  roleProfile,
  skill,
  type Certification,
  type ProofTask,
  type Resource,
  type RoleProfile,
  type Skill,
} from "@/lib/schemas";
import certificationsJson from "./certifications.json";
import proofTasksJson from "./proof-tasks.json";
import resourcesJson from "./resources.json";
import skillsJson from "./skills.json";
import androidDeveloper from "./roles/android-developer.json";
import appsecEngineer from "./roles/appsec-engineer.json";
import businessAnalyst from "./roles/business-analyst.json";
import cloudEngineer from "./roles/cloud-engineer.json";
import cloudSecurityEngineer from "./roles/cloud-security-engineer.json";
import crossPlatformMobileDeveloper from "./roles/cross-platform-mobile-developer.json";
import cyberSecurityAnalyst from "./roles/cyber-security-analyst.json";
import dataAnalyst from "./roles/data-analyst.json";
import dataEngineer from "./roles/data-engineer.json";
import dataScientist from "./roles/data-scientist.json";
import databaseArchitect from "./roles/database-architect.json";
import devopsEngineer from "./roles/devops-engineer.json";
import digitalMarketingExecutive from "./roles/digital-marketing-executive.json";
import engineeringManager from "./roles/engineering-manager.json";
import frontendDeveloper from "./roles/frontend-developer.json";
import fullStackDeveloper from "./roles/full-stack-developer.json";
import grcManager from "./roles/grc-manager.json";
import informationSecurityAnalyst from "./roles/information-security-analyst.json";
import iosDeveloper from "./roles/ios-developer.json";
import javaBackendDeveloper from "./roles/java-backend-developer.json";
import mlEngineer from "./roles/ml-engineer.json";
import penetrationTester from "./roles/penetration-tester.json";
import privacyAnalyst from "./roles/privacy-analyst.json";
import productManager from "./roles/product-manager.json";
import qaAutomationEngineer from "./roles/qa-automation-engineer.json";
import seniorBackendEngineer from "./roles/senior-backend-engineer.json";
import seniorDataScientist from "./roles/senior-data-scientist.json";
import siteReliabilityEngineer from "./roles/site-reliability-engineer.json";
import socAnalystL2 from "./roles/soc-analyst-l2.json";
import socLead from "./roles/soc-lead.json";
import uiUxDesigner from "./roles/ui-ux-designer.json";

/** The skill taxonomy. Validated at import so a bad edit fails tests and the build. */
export const skills: Skill[] = z.array(skill).parse(skillsJson);

/** Certifications that role profiles can recommend. */
export const certifications: Certification[] = z.array(certification).parse(certificationsJson);

/** The reviewed resource catalog (FR-17). Seeded into the resources table; paths link only to these. */
export const resources: Resource[] = z.array(resource).parse(resourcesJson);

/** Fallback proof-of-skill tasks, one per skill, for when the model is not available. */
export const proofTasks: ProofTask[] = z.array(proofTask).parse(proofTasksJson);

/** Hand-built role profiles (FR-8, FR-9). Unpublished until a domain expert sets reviewedBy. */
export const roleProfiles: RoleProfile[] = z
  .array(roleProfile)
  .parse([
    androidDeveloper,
    appsecEngineer,
    businessAnalyst,
    cloudEngineer,
    cloudSecurityEngineer,
    crossPlatformMobileDeveloper,
    cyberSecurityAnalyst,
    dataAnalyst,
    dataEngineer,
    dataScientist,
    databaseArchitect,
    devopsEngineer,
    digitalMarketingExecutive,
    engineeringManager,
    frontendDeveloper,
    fullStackDeveloper,
    grcManager,
    informationSecurityAnalyst,
    iosDeveloper,
    javaBackendDeveloper,
    mlEngineer,
    penetrationTester,
    privacyAnalyst,
    productManager,
    qaAutomationEngineer,
    seniorBackendEngineer,
    seniorDataScientist,
    siteReliabilityEngineer,
    socAnalystL2,
    socLead,
    uiUxDesigner,
  ]);

export function normalizeSkillTerm(term: string): string {
  return term.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Maps a normalized name or alias to its skill id. Exact match only. */
export const skillIdByTerm: ReadonlyMap<string, string> = new Map(
  skills.flatMap((s) => [s.id, s.name, ...s.aliases].map((t) => [normalizeSkillTerm(t), s.id] as const)),
);
