# Zeni — gestor financeiro por voz

Uma tela, um botão. Você fala, a Zeni anota quem te deve, quem você deve, quanto e até quando.

> "Fala Zeni, coloca o João na lista, ele me deve 200 reais e tenho que receber até dia 15."
> "Opa, desconta 50 da conta do João, ele me pagou ontem, esqueci de avisar."
> "Quanto a Ana ainda me deve?"

- **Tela:** botão grande no centro pra falar com a IA, ⚙️ configurações no canto superior esquerdo e ✏️ (lápis com wifi cortado) no canto inferior direito.
- **Login:** e-mail + senha, várias sessões (um por aparelho) e "esqueci minha senha" com código de 6 dígitos por e-mail.
- **Configurações:** nome, e-mail, voz masculina/feminina, moeda, idioma (ou automático), alterar senha, sair e, separado e em destaque, **Deletar conta** (só funciona digitando `DELETAR`).
- **Lápis:** controle financeiro que funciona **offline**: ver saldos, lançar/remover registros e baixar a planilha `.xlsx`.

## Deploy (stack Docker + Cloudflare)

1. **Portainer → Stacks → Add stack → Repository**, apontando para este repositório (compose: `docker-compose.yml`).
2. Preencha as variáveis de ambiente da stack:
   | Variável | Pra quê |
   |---|---|
   | `QWEN_API_KEY` | Chave do Alibaba Cloud Model Studio (DashScope). Sem ela a voz fica desligada, o resto funciona. |
   | `RESEND_API_KEY` / `EMAIL_FROM` | Envio do código de recuperação de senha. Sem ela, o código aparece no log do container (`docker logs zeni`). |
   | `ZENI_PORT` | Porta no host (padrão `3000`). |
   As outras variáveis do `docker-compose.yml` já têm valor padrão.
3. **Cloudflare Zero Trust → Tunnels → Public Hostname** apontando para `http://<ip-do-servidor>:3000` (ou `http://zeni:3000` se o `cloudflared` estiver na mesma rede Docker; tem um serviço pronto comentado no compose).
4. Abra `https://seu-dominio` no celular. **HTTPS é obrigatório**: sem ele o microfone e o service worker não funcionam.

Os dados (SQLite + planilhas) ficam no volume `zeni-data`. Faça backup dele.

## Virando app iOS (PWABuilder)

1. Com o site no ar, acesse [pwabuilder.com](https://www.pwabuilder.com) e informe a URL. O manifest, ícones, screenshots e service worker já estão prontos.
2. **Package for stores → iOS**. Ele gera um projeto Xcode que abre o seu site dentro do app.
3. No Xcode, em `Info.plist`, adicione `NSMicrophoneUsageDescription` (ex.: "A Zeni usa o microfone para ouvir seus comandos de voz.").
4. Assine com sua conta Apple Developer e envie pelo Xcode/TestFlight.

No app iOS (WebView) o reconhecimento de voz do navegador não existe. Por isso mantenha `QWEN_ASR_MODEL` configurado. O backup `.xlsx` fica guardado no app e é exportado pelo botão "Baixar planilha", que abre a folha de compartilhamento (Salvar em Arquivos, AirDrop, etc.).

## Rodando localmente

Requer Node.js 22.13+ (usa o SQLite que já vem no Node, sem dependências nativas).

```bash
npm install
cp .env.example .env     # coloque suas chaves
npm start                # http://localhost:3000
npm test
```

## Qwen

| Função | Modelo padrão | Se ficar vazio |
|---|---|---|
| Entender comandos (function calling) | `qwen-plus` | obrigatório |
| Ouvir (voz → texto, detecta o idioma sozinho) | `qwen3-asr-flash` | usa o reconhecimento do navegador (não existe no app iOS) |
| Falar (texto → voz) | `qwen3-tts-flash`: `Cherry` (feminina) / `Ethan` (masculina) | usa a voz do próprio aparelho |

Para rodar o Qwen no seu próprio servidor, aponte `QWEN_BASE_URL` para qualquer endpoint compatível com OpenAI (Ollama, vLLM), ex.: `http://ollama:11434/v1` com `QWEN_CHAT_MODEL=qwen3`.

A Zeni responde no idioma em que você falou. Se o idioma estiver fixo nas configurações, ela responde sempre nele.

## Login e segurança

- Senhas com **scrypt** (sal por usuário); tokens de sessão guardados só como hash SHA-256.
- Sessão por aparelho, expira após 180 dias sem uso. **Sair** encerra só a sessão daquele aparelho.
- **Alterar senha** desconecta os outros aparelhos. **Redefinir senha** (por código) desconecta todos.
- Código de recuperação: 6 dígitos, vale 15 min, no máximo 5 tentativas, uso único. A resposta é igual exista ou não a conta.
- Limite de tentativas erradas: 10 por e-mail e 50 por IP a cada 15 min (o IP real vem do header `CF-Connecting-IP` da Cloudflare).
- Se a sessão expirar com alterações offline pendentes, elas são mantidas e enviadas assim que você entra de novo na mesma conta.

## Como funciona a sincronização

Cada alteração (dívida, pagamento, remoção, etc.) é um registro imutável com ID e data/hora. O saldo é sempre recalculado a partir desse histórico.

1. A cada comando de voz ou edição, o servidor grava a alteração e **regera a planilha**, sobrescrevendo a anterior.
2. O aparelho também regera a planilha localmente e **sobrescreve o backup** (um arquivo só, sempre o mais recente).
3. Offline (ou com o servidor fora do ar), as edições feitas no lápis ficam na fila. Um ponto no ícone avisa que há alterações pendentes.
4. Quando a conexão volta, o app envia o que está pendente e recebe o que mudou no servidor. Os dois históricos são **unidos** (não é "um sobrescreve o outro"), então nada se perde mesmo se houve mudança dos dois lados ou em dois aparelhos.
5. Se o servidor tiver menos histórico que o aparelho (ex.: foi restaurado de um backup antigo), o aparelho reenvia tudo automaticamente.

A planilha tem três abas: **Resumo** (saldo por pessoa, próximo vencimento e situação: atrasado/em aberto/quitado), **Lançamentos** e **Histórico**.

## Estrutura

```
server/
  index.js       API: login, conta, /sync, /turn (voz), /spreadsheet
  auth.js        senhas, sessões, limite de tentativas, e-mail de recuperação
  assistant.js   prompt + loop de function calling com o Qwen
  tools.js       ferramentas que a IA pode usar (add_debt, register_payment, ...)
  qwen.js        chamadas ao Qwen (chat, ASR, TTS)
  db.js          SQLite
shared/          roda no servidor E no aparelho
  ledger.js      histórico de alterações → saldos; merge da sincronização
  spreadsheet.js geração do .xlsx
public/          PWA (HTML/CSS/JS puro, sem build)
test/            testes (node:test)
Dockerfile, docker-compose.yml
```
