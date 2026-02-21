/**
 * GCP Bootstrap Constants
 *
 * APIs and roles required for the framework to function.
 * Used by infra:bootstrap command.
 */

/**
 * GCP APIs that must be enabled for the framework
 */
export const GCP_REQUIRED_APIS = [
  'secretmanager.googleapis.com',
  'run.googleapis.com',
  'artifactregistry.googleapis.com',
  'sqladmin.googleapis.com',
  'redis.googleapis.com',
  'compute.googleapis.com',
  'vpcaccess.googleapis.com',
  'servicenetworking.googleapis.com',
  'cloudresourcemanager.googleapis.com',
  'certificatemanager.googleapis.com',
  'dns.googleapis.com',
  'cloudfunctions.googleapis.com', // For env-auth function
  'cloudbuild.googleapis.com', // Required by Cloud Functions 2nd gen
  'cloudscheduler.googleapis.com', // For scheduled jobs
  'storage.googleapis.com', // For Terraform state bucket + SPA uploads
] as const;

/**
 * IAM roles added to Deploy SA by infra:bootstrap
 * These are in addition to the 2 initial roles user creates:
 * - roles/iam.securityAdmin
 * - roles/serviceusage.serviceUsageAdmin
 */
export const GCP_DEPLOY_SA_ROLES = [
  'roles/run.admin',
  'roles/artifactregistry.admin',
  'roles/secretmanager.admin',
  'roles/cloudsql.admin',
  'roles/redis.admin',
  'roles/compute.admin', // Full compute (VPCs, NEGs, load balancers)
  'roles/vpcaccess.admin',
  'roles/servicenetworking.networksAdmin', // VPC peering for Cloud SQL private IP
  'roles/storage.admin',
  'roles/iam.serviceAccountAdmin',
  'roles/iam.serviceAccountUser',
  'roles/certificatemanager.owner', // SSL certificates with DNS authorization
  'roles/dns.admin', // Private DNS zones for internal Cloud Run routing
  'roles/cloudfunctions.admin', // Cloud Functions for env-auth
  'roles/cloudbuild.builds.builder', // Required by Cloud Functions 2nd gen
  'roles/cloudscheduler.admin', // For scheduled jobs
] as const;
