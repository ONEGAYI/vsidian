# 本地 HTTPS 测试证书（#130 受控测试服务夹具）

`localhost-cert.pem` / `localhost-key.pem`：自签证书，SAN = `DNS:localhost,
IP:127.0.0.1`，有效期至 2056 年（30 年），CN `vsidian-local-https-test`。

生成命令（重新生成时保持同参数）：

```sh
openssl req -x509 -newkey rsa:2048 \
  -keyout localhost-key.pem -out localhost-cert.pem \
  -days 10950 -nodes -subj "/CN=vsidian-local-https-test" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
```

用途：`test/browser/cssHttpsImports.mjs` 与集成用例（#130）的本地受控
HTTPS 服务（node `https` server 提供 CSS/字体/失败端点）。密钥仅服务
127.0.0.1 回环上的测试流量，无私有价值。

与生产的差异（如实声明，测试注释同述）：Playwright 经
`ignoreHTTPSErrors: true` 跳过证书校验——真实用户环境里浏览器会对服务
做完整证书链校验。TLS 之上的行为（CSP 源匹配、CORS、字体装载、HTTP
缓存语义）与生产同栈；真 HTTPS + 浏览器证书校验的链路由在线字体服务
烟测（`test/browser/cssGoogleFontsSmoke.mjs`，人工运行留证）覆盖。
