// Discoverability audits and findings.
// Methods of Database, merged into its prototype (see database/db.js).
const discoverabilityRepository = {
  async saveDiscoverabilityAudit(productionId, platform, report = {}) {
    const auditId = this.generateId('discoverability');
    const findings = Array.isArray(report.findings) ? report.findings : [];
    await this.executeQuery('BEGIN TRANSACTION');
    try {
      await this.executeQuery(
        `INSERT INTO discoverability_audits (
          id, production_id, platform, mode, engine, engine_version,
          schema_version, status, summary, error_code, error
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          auditId,
          productionId,
          platform || 'youtube',
          report.mode || 'content',
          report.engine?.name || 'darkzseo',
          report.engine?.version || null,
          report.schemaVersion || null,
          report.status || 'unavailable',
          JSON.stringify(report.summary || {}),
          report.errorCode || null,
          report.error || null
        ]
      );

      for (const finding of findings) {
        const previous = await this.getRow(
          `SELECT df.review_status, df.review_reason, df.reviewed_at
           FROM discoverability_findings df
           JOIN discoverability_audits da ON da.id = df.audit_id
           WHERE da.production_id = ? AND da.platform = ? AND df.fingerprint = ?
           ORDER BY df.created_at DESC, df.rowid DESC LIMIT 1`,
          [productionId, platform || 'youtube', finding.fingerprint]
        );
        await this.executeQuery(
          `INSERT INTO discoverability_findings (
            id, audit_id, rule_id, category, severity, applicability,
            message, remediation, fingerprint, review_status, review_reason, reviewed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            this.generateId('finding'), auditId, finding.ruleId, finding.category,
            finding.severity, JSON.stringify(finding.applicability || []), finding.message,
            finding.remediation || null, finding.fingerprint,
            previous?.review_status || 'pending', previous?.review_reason || null,
            previous?.reviewed_at || null
          ]
        );
      }
      await this.executeQuery('COMMIT');
    } catch (error) {
      await this.executeQuery('ROLLBACK');
      throw error;
    }
    return this.getDiscoverabilityAudit(auditId);
  },

  async getDiscoverabilityAudit(auditId) {
    const row = await this.getRow('SELECT * FROM discoverability_audits WHERE id = ?', [auditId]);
    if (!row) return null;
    const findings = await this.getAllRows(
      'SELECT * FROM discoverability_findings WHERE audit_id = ? ORDER BY CASE severity WHEN \'CRITICAL\' THEN 0 WHEN \'HIGH\' THEN 1 WHEN \'MEDIUM\' THEN 2 WHEN \'LOW\' THEN 3 ELSE 4 END, created_at ASC',
      [auditId]
    );
    return this.deserializeDiscoverabilityAudit(row, findings);
  },

  async getLatestDiscoverabilityAudit(productionId, platform = 'youtube') {
    const row = await this.getRow(
      `SELECT * FROM discoverability_audits
       WHERE production_id = ? AND platform = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      [productionId, platform]
    );
    if (!row) return null;
    const findings = await this.getAllRows(
      'SELECT * FROM discoverability_findings WHERE audit_id = ? ORDER BY CASE severity WHEN \'CRITICAL\' THEN 0 WHEN \'HIGH\' THEN 1 WHEN \'MEDIUM\' THEN 2 WHEN \'LOW\' THEN 3 ELSE 4 END, created_at ASC',
      [row.id]
    );
    return this.deserializeDiscoverabilityAudit(row, findings);
  },

  deserializeDiscoverabilityAudit(row, findings = []) {
    const parsedFindings = findings.map(finding => ({
      ...finding,
      ruleId: finding.rule_id,
      applicability: JSON.parse(finding.applicability || '[]'),
      reviewStatus: finding.review_status,
      reviewReason: finding.review_reason,
      reviewedAt: finding.reviewed_at
    }));
    return {
      ...row,
      productionId: row.production_id,
      engineVersion: row.engine_version,
      schemaVersion: row.schema_version,
      errorCode: row.error_code,
      summary: JSON.parse(row.summary || '{}'),
      findings: parsedFindings,
      pendingCount: parsedFindings.filter(finding => finding.reviewStatus === 'pending').length
    };
  },

  async getDiscoverabilityFinding(findingId) {
    const row = await this.getRow(
      `SELECT df.*, da.production_id, da.platform
       FROM discoverability_findings df
       JOIN discoverability_audits da ON da.id = df.audit_id WHERE df.id = ?`,
      [findingId]
    );
    return row ? {
      ...row,
      ruleId: row.rule_id,
      applicability: JSON.parse(row.applicability || '[]'),
      reviewStatus: row.review_status,
      reviewReason: row.review_reason,
      reviewedAt: row.reviewed_at
    } : null;
  },

  async reviewDiscoverabilityFinding(findingId, status, reason) {
    await this.executeQuery(
      `UPDATE discoverability_findings SET review_status = ?, review_reason = ?, reviewed_at = datetime('now')
       WHERE id = ?`,
      [status, reason || null, findingId]
    );
    return this.getDiscoverabilityFinding(findingId);
  }
};

module.exports = { discoverabilityRepository };
