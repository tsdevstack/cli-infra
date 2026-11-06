/**
 * Is Service CPU Always On
 *
 * Cloud Run gives a service CPU only while it handles a request, unless the
 * service keeps its CPU between requests (instance-based billing). A NestJS
 * service that keeps at least one instance running gets CPU all the time, so
 * its message handlers and other background work run while no request comes
 * in: min instances 1 means "always runs", as on AWS and Azure. Next.js only
 * works during requests. Workers always keep their CPU (deploy-worker).
 */

export function isServiceCpuAlwaysOn(
  serviceType: string | undefined,
  minInstances: number,
): boolean {
  return serviceType === 'nestjs' && minInstances >= 1;
}
