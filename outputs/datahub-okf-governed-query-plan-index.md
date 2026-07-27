# DataHub + OKF Governed Query — 実装計画索引

## 結論

このMVPは、**DataHub MCPから読んだデータをDataHub MCPへ戻す設計ではありません**。

扱うデータは次の3種類で、出所と行き先が異なります。

| データ | 正本 | 用途 | 行き先 |
|---|---|---|---|
| データセット／スキーマの事実 | DataHub | 対象リソースとフィールド構成の確認 | リクエスト内の一時的な証拠 |
| 利用ルール | レビュー済みOKFからコンパイルしたPolicy IR | 投影・絞り込みの許可判定 | Query Executorのみ |
| クエリ結果 | PostgreSQL | 許可済みの合成データ取得 | MCP呼び出し元のみ |

MVPはDataHubへ何も書き戻しません。将来書き戻す場合も、別の
proposal-only publisherとして、証拠IDとdigestだけを扱います。クエリ結果や
OKF全文は保存しません。

## 採用アーキテクチャ

```text
MCP caller
  → Context MCP
      → pinned DataHub MCP（read-only metadata evidence）
      → private UDS
          → Query Executor
              → reviewed Policy IR
              → live PostgreSQL schema/role verification
              → fixed typed SQL compiler
              → bounded query
              → rollback confirmed
  ← validated structured result
```

- DataHubは事実の確認元であり、`ALLOW`を生成できません。
- OKFの`verified`記述自体は認証として扱いません。保護されたGitHub review、
  commit、artifact、digestの組を実行時権限の根拠にします。
- LLMは説明を読めますが、認可判定には参加しません。
- Query Executorは任意SQLを受け取りません。閉じた型付きintentだけを固定SQLへ
  コンパイルします。

## 実装文書

1. [全体設計](../docs/superpowers/specs/2026-07-28-datahub-okf-governed-query-design.md)
2. [Stage 1 — 再現可能な基盤、型、OKFコンパイラ](../docs/superpowers/plans/2026-07-28-datahub-okf-foundation-policy.md)
3. [Stage 2A — Context MCPとDataHub evidence adapter](../docs/superpowers/plans/2026-07-28-datahub-okf-context-mcp.md)
4. [Stage 2B — Query Executor、DB境界、Lean証明](../docs/superpowers/plans/2026-07-28-datahub-okf-query-executor.md)
5. [Stage 3 — 実サービス統合、供給網、ハッカソンデモ](../docs/superpowers/plans/2026-07-28-datahub-okf-integration-hardening.md)

各Delivery表の1行が1 branch／1 PR／1 taskです。stacked PRは使わず、各PRを
`main`へmergeしてから次へ進みます。`Files (exhaustive)`列がstagingの正本です。

## 実装順序

1. Foundation 1Aから5Hまでを順にmergeする。
2. Context MCP Task 1をshared-root scaffoldとして先にmergeする。
3. 以後は、Context Task 2–7とQuery Task 1–10を各lane内の順序どおり進める。
   app-owned fileの実装は並行可能だが、shared registryを含むPRのmerge queueは
   1本に直列化する。各branchは最終review前に最新`main`を取り込み、触れたlockを
   再生成し、shared gateを再実行する。
4. 両Stage 2 laneのmerge完了後、Integration 1Aから6Bまでを順にmergeする。
5. clean clone、clean Docker state、保護されたartifact identityから最終demo gateを
   実行する。

各PRは独立taskとして最新`main`へ着地し、code review後にmergeします。

## 絶対に外さないセキュリティ不変条件

- 未知・曖昧・解析失敗・期限切れ・DataHub不通・schema driftはすべてdeny。
- `email`の投影・filterはDB checkout前にdenyし、application query数を0にする。
- PostgreSQL executor roleは固定4カラムのcolumn-level `SELECT`のみ。table-level
  `SELECT`、`email`、`PUBLIC`、TEMP、危険なroutine権限を持たない。
- boot時とlock取得後の実スキーマ投影＋domain-separated digestが一致しなければ
  SQLを実行しない。
- policy freshnessはpreflightだけでなく、`BEGIN`直前とapplication query直前に
  wall clockとmonotonic deadlineの両方で再確認する。
- UDS admissionで作った1つのnon-resetting deadlineとAbortSignalを、frame、
  cursor read/close、`ROLLBACK`まで使い回す。延長・再生成しない。
- 結果行はprivate bufferに保持し、`ROLLBACK`成功後だけ公開する。不確実なcleanup
  はclientを破棄し、行を全廃棄する。
- review済みpolicy artifactはrepository ID、workflow run ID、artifact ID、
  reviewed commit、4つのraw SHA-256をsealed receiptへ束縛する。build前、build内、
  image lock時に再hashする。
- ログとauditにSQL、値、結果、email、token、DSN、raw errorを残さない。
- MCPの`readOnlyHint`などのannotationを認可機構として扱わない。

## 最終GO条件

- 4 native platformの固定Nix toolchain gateが成功。
- TypeScript/Biome、TCB、shell TCB、SQL TCB、workflow allowlistが成功。
- PostgreSQL 18.4の実integration testが毎回fresh volumeで成功。
- Leanの状態遷移定理がコンパイルされ、`Print axioms` gateで未承認axiomが0。
- 2つのclean checkoutから作った`linux/amd64` imageのraw manifest bytesとdigestが
  一致。
- SBOM、脆弱性、secret、license、artifact attestationの必須gateがすべて`PASS`。
- safe queryはapplication query数1、email queryは0、rollback前の公開行は0。
- demo終了後にtoken、entity、policy、volume、registry、secret、download artifactを
  検証付きで破棄。

## 残る信頼境界

厳密化後も、保護されたGitHub repository/build管理者、PostgreSQL管理者または
host root、誤って承認されたpolicy、DataHubの意味的な古さ、依存関係の未知の欠陥、
DoS、ローカルOSユーザー侵害は信頼境界として残ります。

したがって、これは合成データを使う厳密なハッカソン実証であり、そのまま
production securityを主張するものではありません。

## 確認した一次情報

- [MCP TypeScript SDK v1.29.0 transport](https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.29.0/src/shared/transport.ts)
- [MCP TypeScript SDK v1.29.0 protocol types](https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.29.0/src/types.ts)
- [OKF specification at the pinned commit](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/3fcbb9f828c2f23d109c855ee403c3a4c81f3a96/okf/SPEC.md)
- [DataHub authentication at the pinned v1.6.0 commit](https://github.com/datahub-project/datahub/blob/059a36c0b035a6057de00114ccac0ea9003d6bc2/docs/authentication/README.md)
- [DataHub Core entity READ/EXISTS privilege map at the pinned commit](https://github.com/datahub-project/datahub/blob/059a36c0b035a6057de00114ccac0ea9003d6bc2/metadata-utils/src/main/java/com/linkedin/metadata/authorization/PoliciesConfig.java#L1028-L1062)
- [DataHub MCP entity and schema tool implementation at the pinned commit](https://github.com/acryldata/mcp-server-datahub/blob/9a6946daa7d30eb481c82dd8ee5e15ae6526a3c9/src/mcp_server_datahub/tools/entities.py)
- [PostgreSQL 18 transaction characteristics](https://www.postgresql.org/docs/18/sql-set-transaction.html)
- [GitHub CODEOWNERS behavior](https://docs.github.com/en/enterprise-cloud@latest/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners)
- [GitHub artifact attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations)
- [Docker OCI image exporter](https://docs.docker.com/build/exporters/oci-docker/)
