// Groups (besides CALCULATION_REPORT_GROUP_ID) that may run /calculate.
// Rows are managed directly in SQL — there is no command or UI for them.
class CalculateAccessRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async isAllowed(groupId) {
    const result = await this.pool.query(
      'SELECT active FROM calculate_access_groups WHERE group_id=$1',
      [groupId]
    );
    return Boolean(result.rows[0] && result.rows[0].active);
  }
}

module.exports = CalculateAccessRepository;
