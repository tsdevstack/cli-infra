/**
 * AWS Bootstrap Constants
 *
 * IAM actions required for the framework to function.
 * Used by infra:bootstrap command.
 */

/**
 * IAM actions required for the framework
 * These are checked during bootstrap and needed for full infrastructure management.
 */
export const AWS_REQUIRED_ACTIONS = [
  // S3 - for state bucket and SPA hosting
  's3:CreateBucket',
  's3:PutBucketVersioning',
  's3:PutBucketEncryption',
  's3:PutPublicAccessBlock',
  's3:GetObject',
  's3:PutObject',
  's3:DeleteObject',
  's3:ListBucket',

  // DynamoDB - for Terraform state locking
  'dynamodb:CreateTable',
  'dynamodb:DescribeTable',
  'dynamodb:GetItem',
  'dynamodb:PutItem',
  'dynamodb:DeleteItem',

  // Secrets Manager
  'secretsmanager:CreateSecret',
  'secretsmanager:GetSecretValue',
  'secretsmanager:PutSecretValue',
  'secretsmanager:DeleteSecret',
  'secretsmanager:ListSecrets',

  // ECR - container registry
  'ecr:CreateRepository',
  'ecr:DescribeRepositories',
  'ecr:GetAuthorizationToken',
  'ecr:BatchCheckLayerAvailability',
  'ecr:InitiateLayerUpload',
  'ecr:UploadLayerPart',
  'ecr:CompleteLayerUpload',
  'ecr:PutImage',

  // ECS - container orchestration
  'ecs:CreateCluster',
  'ecs:CreateService',
  'ecs:UpdateService',
  'ecs:RegisterTaskDefinition',
  'ecs:DescribeClusters',
  'ecs:DescribeServices',
  'ecs:DescribeTaskDefinition',

  // RDS - PostgreSQL
  'rds:CreateDBInstance',
  'rds:CreateDBSubnetGroup',
  'rds:DescribeDBInstances',
  'rds:ModifyDBInstance',

  // ElastiCache - Redis
  'elasticache:CreateCacheCluster',
  'elasticache:CreateCacheSubnetGroup',
  'elasticache:DescribeCacheClusters',

  // VPC/Networking
  'ec2:CreateVpc',
  'ec2:CreateSubnet',
  'ec2:CreateInternetGateway',
  'ec2:CreateNatGateway',
  'ec2:CreateSecurityGroup',
  'ec2:AuthorizeSecurityGroupIngress',
  'ec2:AuthorizeSecurityGroupEgress',
  'ec2:DescribeVpcs',
  'ec2:DescribeSubnets',
  'ec2:DescribeSecurityGroups',
  'ec2:AllocateAddress',

  // Load Balancer
  'elasticloadbalancing:CreateLoadBalancer',
  'elasticloadbalancing:CreateTargetGroup',
  'elasticloadbalancing:CreateListener',
  'elasticloadbalancing:DescribeLoadBalancers',

  // CloudFront
  'cloudfront:CreateDistribution',
  'cloudfront:CreateInvalidation',
  'cloudfront:GetDistribution',

  // ACM - SSL certificates
  'acm:RequestCertificate',
  'acm:DescribeCertificate',
  'acm:DeleteCertificate',

  // Lambda - for wake-up and job invoker
  'lambda:CreateFunction',
  'lambda:UpdateFunctionCode',
  'lambda:InvokeFunction',
  'lambda:GetFunction',

  // EventBridge - for scheduled jobs
  'events:PutRule',
  'events:PutTargets',
  'events:DescribeRule',

  // EventBridge Scheduler - for scheduled jobs
  'scheduler:CreateSchedule',
  'scheduler:GetSchedule',
  'scheduler:UpdateSchedule',
  'scheduler:DeleteSchedule',

  // CloudWatch - for logs and metric alarms (scale-to-zero)
  'logs:CreateLogGroup',
  'logs:CreateLogStream',
  'logs:PutLogEvents',
  'logs:GetLogEvents',
  'cloudwatch:PutMetricAlarm',
  'cloudwatch:DescribeAlarms',
  'cloudwatch:ListTagsForResource',

  // IAM - for service roles
  'iam:CreateRole',
  'iam:AttachRolePolicy',
  'iam:PassRole',
  'iam:GetRole',

  // Application Auto Scaling - for ECS scale-to-zero
  'application-autoscaling:RegisterScalableTarget',
  'application-autoscaling:PutScalingPolicy',
  'application-autoscaling:DescribeScalableTargets',
  'application-autoscaling:ListTagsForResource',

  // App Runner - for Next.js frontend services
  'apprunner:CreateService',
  'apprunner:UpdateService',
  'apprunner:DescribeService',
  'apprunner:ListServices',

  // Service Discovery (Cloud Map) - for ECS service connect
  'servicediscovery:CreatePrivateDnsNamespace',
  'servicediscovery:CreateService',
  'servicediscovery:GetNamespace',

  // Route 53 - DNS management
  'route53:CreateHostedZone',
  'route53:ChangeResourceRecordSets',
  'route53:GetHostedZone',
  'route53:ListHostedZones',

  // WAF - Web Application Firewall
  'wafv2:CreateWebACL',
  'wafv2:GetWebACL',
  'wafv2:UpdateWebACL',
  'wafv2:AssociateWebACL',

  // KMS - Encryption keys
  'kms:CreateKey',
  'kms:DescribeKey',
  'kms:CreateAlias',

  // CloudTrail - Audit logging
  'cloudtrail:CreateTrail',
  'cloudtrail:StartLogging',
  'cloudtrail:GetTrail',
  'cloudtrail:DescribeTrails',

  // STS - for identity verification
  'sts:GetCallerIdentity',
] as const;
