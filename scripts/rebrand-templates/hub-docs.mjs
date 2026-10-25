// These five new upstream translations predate Clisbot's removal of its hosted
// Hub default. Preserve the useful translation while porting reviewed service facts.
const fixes = new Map(
  Object.entries({
    "public-docs/hub/index.zh-CN.md": [
      [
        "[托管 Hub](/docs/hub/hosted) 使用相同的触发器、daemon 和活动模型。[创建免费账号](__UPSTREAM_HOSTED_HUB__)，无需绑卡，也不会过期。",
        "Clisbot 不运营托管 Hub。请在自己的机器上运行个人 Hub，或使用团队自行部署的 Hub；参见[自托管](/docs/hub/self-hosting)。",
      ],
    ],
    "public-docs/cli.zh-CN.md": [
      [
        "每个命令在执行 Hub 或 daemon 工作之前，都会解析并规范化它的目标。地址的优先级依次为：显式的命令地址或 `--hub`、`CLISBOT_HUB_URL`、当前保存的登录地址，最后是托管版默认地址 `__UPSTREAM_HOSTED_HUB__`。托管版默认地址从不会覆盖当前的登录。凭据的优先级依次为：`--api-key <secret>`、`CLISBOT_HUB_API_KEY`，然后是与解析出的地址完全匹配的已保存登录。保存的凭据从不会发送到其他地址。通过参数或环境变量传入的 API 密钥不会被保存。",
        "在远程 Hub 管理中，地址的优先级依次为：显式的命令地址或 `--hub`、`CLISBOT_HUB_URL`、当前保存的登录地址。没有托管版默认地址；都未设置时，命令会停止并要求提供 Hub URL。凭据的优先级依次为：`--api-key <secret>`、`CLISBOT_HUB_API_KEY`，然后是与解析出的地址完全匹配的已保存登录。保存的凭据从不会发送到其他地址。通过参数或环境变量传入的 API 密钥不会被保存。",
      ],
    ],
    "public-docs/hub/api.zh-CN.md": [
      [
        "- [交互式 API 参考](__UPSTREAM_HOSTED_HUB__/api/reference)\n- [OpenAPI 3.1 文档](__UPSTREAM_HOSTED_HUB__/api/openapi.json)\n\n这些是托管版 Clisbot Hub 的标准参考端点。自托管的 Hub 在它自己的地址上提供相同的 `/api/reference` 和 `/api/openapi.json` 路径。",
        "每个 Hub 都在自己的地址上提供参考文档：\n\n- 交互式 API 参考：`<hub-origin>/api/reference`\n- OpenAPI 3.1 文档：`<hub-origin>/api/openapi.json`",
      ],
      [
        "运行 `clisbot hub login [origin]` 获得交互式的 CLI 访问权限。在浏览器中批准后，Clisbot 会在 `CLISBOT_HOME` 下为这个确切的地址保存一个持久、可撤销的组织凭据。未显式指定地址时，CLI 依次使用 `CLISBOT_HUB_URL`、当前保存的登录，然后是 `__UPSTREAM_HOSTED_HUB__`。",
        "**Host 接入使用 `clisbot hub connect <origin>`，不需要 CLI 登录。** 只有明确需要 CLI API 管理并了解其权限时，才使用 `clisbot hub login [origin]`。在浏览器中批准后，Clisbot 会在 `CLISBOT_HOME` 下为这个确切的地址保存一个持久、可撤销的组织凭据。未显式指定地址时，CLI 依次使用 `CLISBOT_HUB_URL`、当前保存的登录；都未设置时会停止并要求提供 Hub URL。",
      ],
    ],
    "public-docs/hub/daemons.zh-CN.md": [
      [
        "地址的优先级依次为：显式的 `[origin]`、`CLISBOT_HUB_URL`、当前保存的登录，最后是 `__UPSTREAM_HOSTED_HUB__`。显式的 `--api-key <secret>` 优先于环境变量和与地址完全一致的已保存登录。",
        "地址的优先级依次为：显式的 `[origin]`、`CLISBOT_HUB_URL`、当前保存的登录。没有托管版默认地址；都未设置时会停止并要求提供 Hub URL。显式的 `--api-key <secret>` 优先于环境变量和与地址完全一致的已保存登录。",
      ],
    ],
    "public-docs/hub/configuration/index.zh-CN.md": [
      [
        "3. 当前保存的登录\n4. `__UPSTREAM_HOSTED_HUB__`",
        "3. 当前保存的登录\n\n没有托管版默认地址；都未设置时，命令会停止并要求提供 Hub URL。",
      ],
    ],
  }),
);

export function rebrandHubDocs(path, input, siteHost = "clisbot.com") {
  if (!path.startsWith("public-docs/") || !path.endsWith(".md")) return input;
  let output = input;
  for (const origin of new Set([
    "https://hub.paseo.sh",
    "https://hub.clisbot.com",
    `https://hub.${siteHost}`,
  ])) {
    output = output.replaceAll(origin, "__UPSTREAM_HOSTED_HUB__");
  }
  for (const [before, after] of fixes.get(path) ?? []) output = output.replace(before, after);
  if (/__UPSTREAM_HOSTED_HUB__|\/docs\/hub\/hosted(?:\.md)?(?:[\s)#/]|$)/.test(output)) {
    throw new Error(`Review upstream hosted Hub publication claims: ${path}`);
  }
  return output;
}
