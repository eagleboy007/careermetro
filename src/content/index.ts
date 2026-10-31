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
import manualEventsRaw from "./manual-events.json";
import eliteShelfJson from "./elite-shelf.json";
import mockBankJson from "./mock-bank.json";
import practiceQuestionsJson from "./practice-questions.json";
import proofTasksJson from "./proof-tasks.json";
import resourcesJson from "./resources.json";
import roleTracksJson from "./role-tracks.json";
import skillsJson from "./skills.json";
import accountsExecutive from "./roles/accounts-executive.json";
import actuarialAnalyst from "./roles/actuarial-analyst.json";
import adOperationsSpecialist from "./roles/ad-operations-specialist.json";
import adasEngineer from "./roles/adas-engineer.json";
import adminFacilitiesExecutive from "./roles/admin-facilities-executive.json";
import aiArchitect from "./roles/ai-architect.json";
import aiEngineer from "./roles/ai-engineer.json";
import aiProductManager from "./roles/ai-product-manager.json";
import aiResearchScientist from "./roles/ai-research-scientist.json";
import amlKycAnalyst from "./roles/aml-kyc-analyst.json";
import analogIcDesignEngineer from "./roles/analog-ic-design-engineer.json";
import analogLayoutEngineer from "./roles/analog-layout-engineer.json";
import analyticsEngineer from "./roles/analytics-engineer.json";
import androidDeveloper from "./roles/android-developer.json";
import applicationSupportEngineer from "./roles/application-support-engineer.json";
import appsecEngineer from "./roles/appsec-engineer.json";
import arVrDeveloper from "./roles/ar-vr-developer.json";
import areaSalesManager from "./roles/area-sales-manager.json";
import articleAssistantCa from "./roles/article-assistant-ca.json";
import auditAssociate from "./roles/audit-associate.json";
import automotiveDiagnosticsEngineer from "./roles/automotive-diagnostics-engineer.json";
import autosarEngineer from "./roles/autosar-engineer.json";
import backOfficeExecutive from "./roles/back-office-executive.json";
import bankProbationaryOfficer from "./roles/bank-probationary-officer.json";
import biDeveloper from "./roles/bi-developer.json";
import billingQuantityEngineerCivil from "./roles/billing-quantity-engineer-civil.json";
import biostatistician from "./roles/biostatistician.json";
import blockchainDeveloper from "./roles/blockchain-developer.json";
import bmsEngineer from "./roles/bms-engineer.json";
import brandManager from "./roles/brand-manager.json";
import buildReleaseEngineer from "./roles/build-release-engineer.json";
import businessAnalyst from "./roles/business-analyst.json";
import businessDevelopmentExecutive from "./roles/business-development-executive.json";
import caeSimulationEngineer from "./roles/cae-simulation-engineer.json";
import categoryManagerEcommerce from "./roles/category-manager-ecommerce.json";
import channelSalesManager from "./roles/channel-sales-manager.json";
import clinicalDataManager from "./roles/clinical-data-manager.json";
import clinicalSasProgrammer from "./roles/clinical-sas-programmer.json";
import cloudArchitect from "./roles/cloud-architect.json";
import cloudEngineer from "./roles/cloud-engineer.json";
import cloudFinopsAnalyst from "./roles/cloud-finops-analyst.json";
import cloudNetworkEngineer from "./roles/cloud-network-engineer.json";
import cloudSecurityEngineer from "./roles/cloud-security-engineer.json";
import cloudSupportEngineer from "./roles/cloud-support-engineer.json";
import collectionsOfficer from "./roles/collections-officer.json";
import companySecretaryAssociate from "./roles/company-secretary-associate.json";
import compensationBenefitsAnalyst from "./roles/compensation-benefits-analyst.json";
import computerVisionEngineer from "./roles/computer-vision-engineer.json";
import contactCenterDeveloper from "./roles/contact-center-developer.json";
import contentWriter from "./roles/content-writer.json";
import contractManagementSpecialist from "./roles/contract-management-specialist.json";
import coreBankingConsultant from "./roles/core-banking-consultant.json";
import corporateLegalAssociate from "./roles/corporate-legal-associate.json";
import costAccountant from "./roles/cost-accountant.json";
import cppDeveloper from "./roles/cpp-developer.json";
import creditRiskAnalyst from "./roles/credit-risk-analyst.json";
import crossPlatformMobileDeveloper from "./roles/cross-platform-mobile-developer.json";
import customerServiceTeamLeader from "./roles/customer-service-team-leader.json";
import customerSuccessManager from "./roles/customer-success-manager.json";
import customerSupportExecutive from "./roles/customer-support-executive.json";
import cyberSecurityAnalyst from "./roles/cyber-security-analyst.json";
import dataAnalyst from "./roles/data-analyst.json";
import dataAnnotationSpecialist from "./roles/data-annotation-specialist.json";
import dataArchitect from "./roles/data-architect.json";
import dataCenterEngineer from "./roles/data-center-engineer.json";
import dataEngineer from "./roles/data-engineer.json";
import dataEngineeringManager from "./roles/data-engineering-manager.json";
import dataGovernanceAnalyst from "./roles/data-governance-analyst.json";
import dataQualityEngineer from "./roles/data-quality-engineer.json";
import dataScientist from "./roles/data-scientist.json";
import databaseAdministrator from "./roles/database-administrator.json";
import databaseArchitect from "./roles/database-architect.json";
import databaseDeveloper from "./roles/database-developer.json";
import deliveryManager from "./roles/delivery-manager.json";
import designVerificationEngineer from "./roles/design-verification-engineer.json";
import developerAdvocate from "./roles/developer-advocate.json";
import devopsEngineer from "./roles/devops-engineer.json";
import devsecopsEngineer from "./roles/devsecops-engineer.json";
import dftEngineer from "./roles/dft-engineer.json";
import digitalForensicsAnalyst from "./roles/digital-forensics-analyst.json";
import digitalMarketingExecutive from "./roles/digital-marketing-executive.json";
import dlpEngineer from "./roles/dlp-engineer.json";
import dotnetDeveloper from "./roles/dotnet-developer.json";
import duckCreekDeveloper from "./roles/duck-creek-developer.json";
import dynamics365Developer from "./roles/dynamics-365-developer.json";
import ecommerceDeveloper from "./roles/ecommerce-developer.json";
import embeddedSoftwareEngineer from "./roles/embedded-software-engineer.json";
import engineeringManager from "./roles/engineering-manager.json";
import equityResearchAnalyst from "./roles/equity-research-analyst.json";
import etlDeveloper from "./roles/etl-developer.json";
import eucEngineer from "./roles/euc-engineer.json";
import evPowertrainEngineer from "./roles/ev-powertrain-engineer.json";
import eventMarketingExecutive from "./roles/event-marketing-executive.json";
import exportImportExecutive from "./roles/export-import-executive.json";
import financialAnalyst from "./roles/financial-analyst.json";
import fmcgSalesOfficer from "./roles/fmcg-sales-officer.json";
import foodBeverageExecutive from "./roles/food-beverage-executive.json";
import forwardDeployedEngineer from "./roles/forward-deployed-engineer.json";
import fpgaEngineer from "./roles/fpga-engineer.json";
import fraudAnalyst from "./roles/fraud-analyst.json";
import frontOfficeExecutiveHotel from "./roles/front-office-executive-hotel.json";
import frontendArchitect from "./roles/frontend-architect.json";
import frontendDeveloper from "./roles/frontend-developer.json";
import fullStackDeveloper from "./roles/full-stack-developer.json";
import functionalSafetyEngineer from "./roles/functional-safety-engineer.json";
import gameArtist3d from "./roles/game-artist-3d.json";
import gameDesigner from "./roles/game-designer.json";
import gameDeveloper from "./roles/game-developer.json";
import gisDeveloper from "./roles/gis-developer.json";
import golangDeveloper from "./roles/golang-developer.json";
import graduateEngineerTraineeElectrical from "./roles/graduate-engineer-trainee-electrical.json";
import graduateEngineerTraineeMechanical from "./roles/graduate-engineer-trainee-mechanical.json";
import graphicDesigner from "./roles/graphic-designer.json";
import grcManager from "./roles/grc-manager.json";
import guidewireDeveloper from "./roles/guidewire-developer.json";
import hardwareDesignEngineer from "./roles/hardware-design-engineer.json";
import healthInsuranceClaimsExecutive from "./roles/health-insurance-claims-executive.json";
import hilTestEngineer from "./roles/hil-test-engineer.json";
import homeLoanSalesOfficer from "./roles/home-loan-sales-officer.json";
import hospitalOperationsExecutive from "./roles/hospital-operations-executive.json";
import hotelRevenueManager from "./roles/hotel-revenue-manager.json";
import housekeepingSupervisor from "./roles/housekeeping-supervisor.json";
import hpcGpuEngineer from "./roles/hpc-gpu-engineer.json";
import hrBusinessPartner from "./roles/hr-business-partner.json";
import hrGeneralist from "./roles/hr-generalist.json";
import iamEngineer from "./roles/iam-engineer.json";
import implementationConsultant from "./roles/implementation-consultant.json";
import incidentResponseAnalyst from "./roles/incident-response-analyst.json";
import industrialRelationsOfficer from "./roles/industrial-relations-officer.json";
import informationSecurityAnalyst from "./roles/information-security-analyst.json";
import infotainmentEngineer from "./roles/infotainment-engineer.json";
import insideSalesExecutive from "./roles/inside-sales-executive.json";
import insuranceUnderwriter from "./roles/insurance-underwriter.json";
import integrationDeveloper from "./roles/integration-developer.json";
import investmentBankingAnalyst from "./roles/investment-banking-analyst.json";
import iosDeveloper from "./roles/ios-developer.json";
import iotEngineer from "./roles/iot-engineer.json";
import itAuditor from "./roles/it-auditor.json";
import itProgramManager from "./roles/it-program-manager.json";
import itProjectManager from "./roles/it-project-manager.json";
import itServiceDeliveryManager from "./roles/it-service-delivery-manager.json";
import itSupportEngineer from "./roles/it-support-engineer.json";
import javaBackendDeveloper from "./roles/java-backend-developer.json";
import kafkaStreamingEngineer from "./roles/kafka-streaming-engineer.json";
import keyAccountManager from "./roles/key-account-manager.json";
import learningDevelopmentSpecialist from "./roles/learning-development-specialist.json";
import linuxKernelDeveloper from "./roles/linux-kernel-developer.json";
import litigationParalegal from "./roles/litigation-paralegal.json";
import logisticsCoordinator from "./roles/logistics-coordinator.json";
import lowCodeDeveloper from "./roles/low-code-developer.json";
import m365Administrator from "./roles/m365-administrator.json";
import mainframeDeveloper from "./roles/mainframe-developer.json";
import maintenanceEngineer from "./roles/maintenance-engineer.json";
import malwareAnalyst from "./roles/malware-analyst.json";
import managementTrainee from "./roles/management-trainee.json";
import manualTestEngineer from "./roles/manual-test-engineer.json";
import marketResearchAnalyst from "./roles/market-research-analyst.json";
import marketingAutomationSpecialist from "./roles/marketing-automation-specialist.json";
import mechanicalDesignEngineer from "./roles/mechanical-design-engineer.json";
import medicalBillingSpecialist from "./roles/medical-billing-specialist.json";
import medicalCoder from "./roles/medical-coder.json";
import medicalRepresentative from "./roles/medical-representative.json";
import mesEngineer from "./roles/mes-engineer.json";
import middlewareAdministrator from "./roles/middleware-administrator.json";
import mlEngineer from "./roles/ml-engineer.json";
import mlEngineeringManager from "./roles/ml-engineering-manager.json";
import mlopsEngineer from "./roles/mlops-engineer.json";
import motionGraphicsDesigner from "./roles/motion-graphics-designer.json";
import motorControlEngineer from "./roles/motor-control-engineer.json";
import murexConsultant from "./roles/murex-consultant.json";
import networkEngineer from "./roles/network-engineer.json";
import networkSecurityEngineer from "./roles/network-security-engineer.json";
import nlpEngineer from "./roles/nlp-engineer.json";
import nocEngineer from "./roles/noc-engineer.json";
import nodejsDeveloper from "./roles/nodejs-developer.json";
import odooDeveloper from "./roles/odoo-developer.json";
import oracleEbsConsultant from "./roles/oracle-ebs-consultant.json";
import oracleFusionTechnicalConsultant from "./roles/oracle-fusion-technical-consultant.json";
import oracleHcmCloudConsultant from "./roles/oracle-hcm-cloud-consultant.json";
import oracleSoaDeveloper from "./roles/oracle-soa-developer.json";
import otSecurityEngineer from "./roles/ot-security-engineer.json";
import pamEngineer from "./roles/pam-engineer.json";
import paymentsEngineer from "./roles/payments-engineer.json";
import payrollExecutive from "./roles/payroll-executive.json";
import pegaDeveloper from "./roles/pega-developer.json";
import penetrationTester from "./roles/penetration-tester.json";
import performanceTestEngineer from "./roles/performance-test-engineer.json";
import phpDeveloper from "./roles/php-developer.json";
import physicalDesignEngineer from "./roles/physical-design-engineer.json";
import platformEngineer from "./roles/platform-engineer.json";
import platformEngineeringManager from "./roles/platform-engineering-manager.json";
import plcScadaEngineer from "./roles/plc-scada-engineer.json";
import plmDeveloper from "./roles/plm-developer.json";
import postSiliconValidationEngineer from "./roles/post-silicon-validation-engineer.json";
import powerPlatformDeveloper from "./roles/power-platform-developer.json";
import presalesEngineer from "./roles/presales-engineer.json";
import privacyAnalyst from "./roles/privacy-analyst.json";
import processExcellenceAnalyst from "./roles/process-excellence-analyst.json";
import procurementExecutive from "./roles/procurement-executive.json";
import productManager from "./roles/product-manager.json";
import productMarketingManager from "./roles/product-marketing-manager.json";
import productionEngineer from "./roles/production-engineer.json";
import pythonDeveloper from "./roles/python-developer.json";
import qaAutomationEngineer from "./roles/qa-automation-engineer.json";
import qaLead from "./roles/qa-lead.json";
import qaManager from "./roles/qa-manager.json";
import qualityControlInspector from "./roles/quality-control-inspector.json";
import quantDeveloper from "./roles/quant-developer.json";
import realEstateSalesExecutive from "./roles/real-estate-sales-executive.json";
import redTeamOperator from "./roles/red-team-operator.json";
import regulatoryComplianceOfficer from "./roles/regulatory-compliance-officer.json";
import relationshipManagerBanking from "./roles/relationship-manager-banking.json";
import retailStoreManager from "./roles/retail-store-manager.json";
import rfIcDesignEngineer from "./roles/rf-ic-design-engineer.json";
import roboticsEngineer from "./roles/robotics-engineer.json";
import rpaDeveloper from "./roles/rpa-developer.json";
import rubyOnRailsDeveloper from "./roles/ruby-on-rails-developer.json";
import rustDeveloper from "./roles/rust-developer.json";
import salesforceAdministrator from "./roles/salesforce-administrator.json";
import salesforceDeveloper from "./roles/salesforce-developer.json";
import sapAbapDeveloper from "./roles/sap-abap-developer.json";
import sapBasisAdministrator from "./roles/sap-basis-administrator.json";
import sapBtpIntegrationDeveloper from "./roles/sap-btp-integration-developer.json";
import sapBwConsultant from "./roles/sap-bw-consultant.json";
import sapEwmConsultant from "./roles/sap-ewm-consultant.json";
import sapFicoConsultant from "./roles/sap-fico-consultant.json";
import sapFioriUi5Developer from "./roles/sap-fiori-ui5-developer.json";
import sapHcmConsultant from "./roles/sap-hcm-consultant.json";
import sapMmConsultant from "./roles/sap-mm-consultant.json";
import sapPmConsultant from "./roles/sap-pm-consultant.json";
import sapPpConsultant from "./roles/sap-pp-consultant.json";
import sapQmConsultant from "./roles/sap-qm-consultant.json";
import sapSdConsultant from "./roles/sap-sd-consultant.json";
import sapSecurityGrcConsultant from "./roles/sap-security-grc-consultant.json";
import sapSuccessfactorsConsultant from "./roles/sap-successfactors-consultant.json";
import scrumMaster from "./roles/scrum-master.json";
import searchEngineer from "./roles/search-engineer.json";
import securityArchitect from "./roles/security-architect.json";
import seniorBackendEngineer from "./roles/senior-backend-engineer.json";
import seniorDataScientist from "./roles/senior-data-scientist.json";
import seoSpecialist from "./roles/seo-specialist.json";
import servicenowAdministrator from "./roles/servicenow-administrator.json";
import servicenowDeveloper from "./roles/servicenow-developer.json";
import sharepointDeveloper from "./roles/sharepoint-developer.json";
import siebelCrmDeveloper from "./roles/siebel-crm-developer.json";
import siemEngineer from "./roles/siem-engineer.json";
import siteEngineerCivil from "./roles/site-engineer-civil.json";
import siteReliabilityEngineer from "./roles/site-reliability-engineer.json";
import socAnalystL2 from "./roles/soc-analyst-l2.json";
import socLead from "./roles/soc-lead.json";
import socialMediaManager from "./roles/social-media-manager.json";
import softwareAssetManager from "./roles/software-asset-manager.json";
import softwareEngineer from "./roles/software-engineer.json";
import solutionsArchitect from "./roles/solutions-architect.json";
import storageBackupEngineer from "./roles/storage-backup-engineer.json";
import supplyChainAnalyst from "./roles/supply-chain-analyst.json";
import systemAdministrator from "./roles/system-administrator.json";
import talentAcquisitionSpecialist from "./roles/talent-acquisition-specialist.json";
import taxAssociate from "./roles/tax-associate.json";
import techLead from "./roles/tech-lead.json";
import technicalAccountManager from "./roles/technical-account-manager.json";
import technicalProgramManager from "./roles/technical-program-manager.json";
import technicalSupportEngineer from "./roles/technical-support-engineer.json";
import technicalWriter from "./roles/technical-writer.json";
import telecomRanEngineer from "./roles/telecom-ran-engineer.json";
import thirdPartyRiskAnalyst from "./roles/third-party-risk-analyst.json";
import threatIntelligenceAnalyst from "./roles/threat-intelligence-analyst.json";
import treasuryAnalyst from "./roles/treasury-analyst.json";
import trustAndSafetyAnalyst from "./roles/trust-and-safety-analyst.json";
import uiUxDesigner from "./roles/ui-ux-designer.json";
import unifiedCommunicationsEngineer from "./roles/unified-communications-engineer.json";
import uxResearcher from "./roles/ux-researcher.json";
import videoEditor from "./roles/video-editor.json";
import virtualizationEngineer from "./roles/virtualization-engineer.json";
import vlsiDesignEngineer from "./roles/vlsi-design-engineer.json";
import vulnerabilityManagementAnalyst from "./roles/vulnerability-management-analyst.json";
import warehouseOperationsExecutive from "./roles/warehouse-operations-executive.json";
import workdayConsultant from "./roles/workday-consultant.json";
import zohoDeveloper from "./roles/zoho-developer.json";

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

/**
 * Hand-entered Timetable events (docs/timetable-sources.md), typed in by the team from organisers' own pages. Left
 * unparsed here: the daily event feed (src/lib/timetable/manual.ts) checks each entry, loads the ones that pass and
 * cancels a removed event only when the whole file passed. src/content/manual-events.test.ts checks the file in CI.
 */
export const manualEventsJson: unknown = manualEventsRaw;

/** Hand-built role profiles (FR-8, FR-9). Unpublished until a domain expert sets reviewedBy. */
export const roleProfiles: RoleProfile[] = z
  .array(roleProfile)
  .parse([
    accountsExecutive,
    actuarialAnalyst,
    adOperationsSpecialist,
    adasEngineer,
    adminFacilitiesExecutive,
    aiArchitect,
    aiEngineer,
    aiProductManager,
    aiResearchScientist,
    amlKycAnalyst,
    analogIcDesignEngineer,
    analogLayoutEngineer,
    analyticsEngineer,
    androidDeveloper,
    applicationSupportEngineer,
    appsecEngineer,
    arVrDeveloper,
    areaSalesManager,
    articleAssistantCa,
    auditAssociate,
    automotiveDiagnosticsEngineer,
    autosarEngineer,
    backOfficeExecutive,
    bankProbationaryOfficer,
    biDeveloper,
    billingQuantityEngineerCivil,
    biostatistician,
    blockchainDeveloper,
    bmsEngineer,
    brandManager,
    buildReleaseEngineer,
    businessAnalyst,
    businessDevelopmentExecutive,
    caeSimulationEngineer,
    categoryManagerEcommerce,
    channelSalesManager,
    clinicalDataManager,
    clinicalSasProgrammer,
    cloudArchitect,
    cloudEngineer,
    cloudFinopsAnalyst,
    cloudNetworkEngineer,
    cloudSecurityEngineer,
    cloudSupportEngineer,
    collectionsOfficer,
    companySecretaryAssociate,
    compensationBenefitsAnalyst,
    computerVisionEngineer,
    contactCenterDeveloper,
    contentWriter,
    contractManagementSpecialist,
    coreBankingConsultant,
    corporateLegalAssociate,
    costAccountant,
    cppDeveloper,
    creditRiskAnalyst,
    crossPlatformMobileDeveloper,
    customerServiceTeamLeader,
    customerSuccessManager,
    customerSupportExecutive,
    cyberSecurityAnalyst,
    dataAnalyst,
    dataAnnotationSpecialist,
    dataArchitect,
    dataCenterEngineer,
    dataEngineer,
    dataEngineeringManager,
    dataGovernanceAnalyst,
    dataQualityEngineer,
    dataScientist,
    databaseAdministrator,
    databaseArchitect,
    databaseDeveloper,
    deliveryManager,
    designVerificationEngineer,
    developerAdvocate,
    devopsEngineer,
    devsecopsEngineer,
    dftEngineer,
    digitalForensicsAnalyst,
    digitalMarketingExecutive,
    dlpEngineer,
    dotnetDeveloper,
    duckCreekDeveloper,
    dynamics365Developer,
    ecommerceDeveloper,
    embeddedSoftwareEngineer,
    engineeringManager,
    equityResearchAnalyst,
    etlDeveloper,
    eucEngineer,
    evPowertrainEngineer,
    eventMarketingExecutive,
    exportImportExecutive,
    financialAnalyst,
    fmcgSalesOfficer,
    foodBeverageExecutive,
    forwardDeployedEngineer,
    fpgaEngineer,
    fraudAnalyst,
    frontOfficeExecutiveHotel,
    frontendArchitect,
    frontendDeveloper,
    fullStackDeveloper,
    functionalSafetyEngineer,
    gameArtist3d,
    gameDesigner,
    gameDeveloper,
    gisDeveloper,
    golangDeveloper,
    graduateEngineerTraineeElectrical,
    graduateEngineerTraineeMechanical,
    graphicDesigner,
    grcManager,
    guidewireDeveloper,
    hardwareDesignEngineer,
    healthInsuranceClaimsExecutive,
    hilTestEngineer,
    homeLoanSalesOfficer,
    hospitalOperationsExecutive,
    hotelRevenueManager,
    housekeepingSupervisor,
    hpcGpuEngineer,
    hrBusinessPartner,
    hrGeneralist,
    iamEngineer,
    implementationConsultant,
    incidentResponseAnalyst,
    industrialRelationsOfficer,
    informationSecurityAnalyst,
    infotainmentEngineer,
    insideSalesExecutive,
    insuranceUnderwriter,
    integrationDeveloper,
    investmentBankingAnalyst,
    iosDeveloper,
    iotEngineer,
    itAuditor,
    itProgramManager,
    itProjectManager,
    itServiceDeliveryManager,
    itSupportEngineer,
    javaBackendDeveloper,
    kafkaStreamingEngineer,
    keyAccountManager,
    learningDevelopmentSpecialist,
    linuxKernelDeveloper,
    litigationParalegal,
    logisticsCoordinator,
    lowCodeDeveloper,
    m365Administrator,
    mainframeDeveloper,
    maintenanceEngineer,
    malwareAnalyst,
    managementTrainee,
    manualTestEngineer,
    marketResearchAnalyst,
    marketingAutomationSpecialist,
    mechanicalDesignEngineer,
    medicalBillingSpecialist,
    medicalCoder,
    medicalRepresentative,
    mesEngineer,
    middlewareAdministrator,
    mlEngineer,
    mlEngineeringManager,
    mlopsEngineer,
    motionGraphicsDesigner,
    motorControlEngineer,
    murexConsultant,
    networkEngineer,
    networkSecurityEngineer,
    nlpEngineer,
    nocEngineer,
    nodejsDeveloper,
    odooDeveloper,
    oracleEbsConsultant,
    oracleFusionTechnicalConsultant,
    oracleHcmCloudConsultant,
    oracleSoaDeveloper,
    otSecurityEngineer,
    pamEngineer,
    paymentsEngineer,
    payrollExecutive,
    pegaDeveloper,
    penetrationTester,
    performanceTestEngineer,
    phpDeveloper,
    physicalDesignEngineer,
    platformEngineer,
    platformEngineeringManager,
    plcScadaEngineer,
    plmDeveloper,
    postSiliconValidationEngineer,
    powerPlatformDeveloper,
    presalesEngineer,
    privacyAnalyst,
    processExcellenceAnalyst,
    procurementExecutive,
    productManager,
    productMarketingManager,
    productionEngineer,
    pythonDeveloper,
    qaAutomationEngineer,
    qaLead,
    qaManager,
    qualityControlInspector,
    quantDeveloper,
    realEstateSalesExecutive,
    redTeamOperator,
    regulatoryComplianceOfficer,
    relationshipManagerBanking,
    retailStoreManager,
    rfIcDesignEngineer,
    roboticsEngineer,
    rpaDeveloper,
    rubyOnRailsDeveloper,
    rustDeveloper,
    salesforceAdministrator,
    salesforceDeveloper,
    sapAbapDeveloper,
    sapBasisAdministrator,
    sapBtpIntegrationDeveloper,
    sapBwConsultant,
    sapEwmConsultant,
    sapFicoConsultant,
    sapFioriUi5Developer,
    sapHcmConsultant,
    sapMmConsultant,
    sapPmConsultant,
    sapPpConsultant,
    sapQmConsultant,
    sapSdConsultant,
    sapSecurityGrcConsultant,
    sapSuccessfactorsConsultant,
    scrumMaster,
    searchEngineer,
    securityArchitect,
    seniorBackendEngineer,
    seniorDataScientist,
    seoSpecialist,
    servicenowAdministrator,
    servicenowDeveloper,
    sharepointDeveloper,
    siebelCrmDeveloper,
    siemEngineer,
    siteEngineerCivil,
    siteReliabilityEngineer,
    socAnalystL2,
    socLead,
    socialMediaManager,
    softwareAssetManager,
    softwareEngineer,
    solutionsArchitect,
    storageBackupEngineer,
    supplyChainAnalyst,
    systemAdministrator,
    talentAcquisitionSpecialist,
    taxAssociate,
    techLead,
    technicalAccountManager,
    technicalProgramManager,
    technicalSupportEngineer,
    technicalWriter,
    telecomRanEngineer,
    thirdPartyRiskAnalyst,
    threatIntelligenceAnalyst,
    treasuryAnalyst,
    trustAndSafetyAnalyst,
    uiUxDesigner,
    unifiedCommunicationsEngineer,
    uxResearcher,
    videoEditor,
    virtualizationEngineer,
    vlsiDesignEngineer,
    vulnerabilityManagementAnalyst,
    warehouseOperationsExecutive,
    workdayConsultant,
    zohoDeveloper,
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
