import { z } from "zod";
import { certification, roleProfile, skill, type Certification, type RoleProfile, type Skill } from "@/lib/schemas";
import certificationsJson from "./certifications.json";
import skillsJson from "./skills.json";
import businessAnalyst from "./roles/business-analyst.json";
import cyberSecurityAnalyst from "./roles/cyber-security-analyst.json";
import dataAnalyst from "./roles/data-analyst.json";
import dataScientist from "./roles/data-scientist.json";
import databaseArchitect from "./roles/database-architect.json";
import devopsEngineer from "./roles/devops-engineer.json";
import digitalMarketingExecutive from "./roles/digital-marketing-executive.json";
import frontendDeveloper from "./roles/frontend-developer.json";
import fullStackDeveloper from "./roles/full-stack-developer.json";
import informationSecurityAnalyst from "./roles/information-security-analyst.json";
import javaBackendDeveloper from "./roles/java-backend-developer.json";
import productManager from "./roles/product-manager.json";
import qaAutomationEngineer from "./roles/qa-automation-engineer.json";

/** The skill taxonomy. Validated at import so a bad edit fails tests and the build. */
export const skills: Skill[] = z.array(skill).parse(skillsJson);

/** Certifications that role profiles can recommend. */
export const certifications: Certification[] = z.array(certification).parse(certificationsJson);

/** Hand-built role profiles (FR-8, FR-9). Unpublished until a domain expert sets reviewedBy. */
export const roleProfiles: RoleProfile[] = z
  .array(roleProfile)
  .parse([
    businessAnalyst,
    cyberSecurityAnalyst,
    dataAnalyst,
    dataScientist,
    databaseArchitect,
    devopsEngineer,
    digitalMarketingExecutive,
    frontendDeveloper,
    fullStackDeveloper,
    informationSecurityAnalyst,
    javaBackendDeveloper,
    productManager,
    qaAutomationEngineer,
  ]);

export function normalizeSkillTerm(term: string): string {
  return term.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Maps a normalized name or alias to its skill id. Exact match only. */
export const skillIdByTerm: ReadonlyMap<string, string> = new Map(
  skills.flatMap((s) => [s.id, s.name, ...s.aliases].map((t) => [normalizeSkillTerm(t), s.id] as const)),
);
