export async function dailyIngestWorkflow() {
  'use workflow';

  return runDailyIngestionStep();
}

export async function weeklyReportsWorkflow() {
  'use workflow';

  return generateWeeklyReportsStep();
}

async function runDailyIngestionStep() {
  'use step';

  const { getIntelligenceUseCases } =
    await import('@/composition/intelligence');
  return getIntelligenceUseCases().runDailyIngestion();
}

async function generateWeeklyReportsStep() {
  'use step';

  const { getIntelligenceUseCases } =
    await import('@/composition/intelligence');
  return getIntelligenceUseCases().generateWeeklyReports();
}
