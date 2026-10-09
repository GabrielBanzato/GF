# Midas — gestor financeiro por voz

Uma tela, um botão. Você fala, o Midas anota quem te deve, quem você deve, quanto e até quando.

> "Fala Midas, coloca o João na lista, ele me deve 200 reais e tenho que receber até dia 15."
> "Opa, desconta 50 da conta do João, ele me pagou ontem, esqueci de avisar."
> "Quanto a Ana ainda me deve?"

- **Tela:** botão grande no centro pra falar com o Midas, ⚙️ configurações no canto superior esquerdo e ✏️ (lápis com wifi cortado) no canto inferior direito.
- **Login:** e-mail + senha, várias sessões (um por aparelho) e "esqueci minha senha" com código de 6 dígitos por e-mail.
- **Configurações:** nome, e-mail, moeda, idioma (ou automático), alterar senha, sair e, separado e em destaque, **Deletar conta** (só funciona digitando `DELETAR`).
- **Lápis:** controle financeiro que funciona **offline**: ver saldos, lançar/remover registros e baixar a planilha `.xlsx`.

## Onde a IA roda

**No próprio iPhone.** O Midas é feito para iPhones com Apple Intelligence (iPhone 15 Pro ou mais novo, iOS 26+):

| Etapa | Recurso | Tempo típico |
|---|---|---|
| Ouvir | Reconhecimento de fala da Apple, no aparelho | instantâneo |
| Entender | Foundation Models (modelo do Apple Intelligence), no aparelho | ~1–2 s |
| Falar | Voz masculina do sistema | instantâneo |

O modelo só classifica o pedido (ação, pessoa, valor, datas). Quem aplica a alteração e escreve a resposta é `shared/commands.js`, e o resultado vira um registro normal que sincroniza com o servidor. Por isso **a voz funciona até offline**, e o servidor (KVM 2 da Hostinger) não roda IA nenhuma: só guarda contas, histórico e planilhas.

Como montar o app no Xcode: **[ios/README.md](ios/README.md)**.

## Deploy (stack Docker + Cloudflare)

1. **Portainer → Stacks → Add stack → Repository**, apontando para este repositório (compose: `docker-compose.yml`).
2. Preencha as variáveis de ambiente da stack:
   | Variável | Pra quê |
   |---|---|
   | `CLOUDFLARE_TUNNEL_TOKEN` | **Obrigatória.** Token do túnel (o texto depois de `--token` no comando de instalação da Cloudflare). |
   | `RESEND_API_KEY` / `EMAIL_FROM` | Envio do código de recuperação de senha. Sem ela, o código aparece no log do container (`docker logs midas`). |
   | `MIDAS_PORT` | Porta no host (padrão `3210`). Se der "port is already allocated", troque por outra livre. |
3. **Cloudflare Zero Trust → Tunnels → Public Hostname:** Tipo `HTTP`, URL `midas:3000`.
4. Abra `https://seu-dominio`. **HTTPS é obrigatório** (service worker e login).

Os dados (SQLite + planilhas) ficam no volume `midas-data`. Faça backup dele.

## Virando app iOS (PWABuilder)

1. Com o site no ar, acesse [pwabuilder.com](https://www.pwabuilder.com) e informe a URL. O manifest, ícones, screenshots e service worker já estão prontos.
2. **Package for stores → iOS** e abra o projeto no Xcode.
3. Adicione a ponte com a IA do iPhone seguindo **[ios/README.md](ios/README.md)**.
4. Assine com sua conta Apple Developer e envie pelo Xcode/TestFlight.

O backup `.xlsx` fica guardado no app e é exportado pelo botão "Baixar planilha", que abre a folha de compartilhamento (Salvar em Arquivos, AirDrop, etc.).

## Rodando localmente

Requer Node.js 22.13+ (usa o SQLite que já vem no Node, sem dependências nativas).

```bash
npm install
cp .env.example .env
npm start                # http://localhost:3000
npm test
```

No navegador (fora do app iOS) não há IA do aparelho: o botão central só funciona se o servidor tiver uma IA configurada (opcional, veja `.env.example`). O resto do app funciona normalmente.

## Login e segurança

- Senhas com **scrypt** (sal por usuário); tokens de sessão guardados só como hash SHA-256.
- Sessão por aparelho, expira após 180 dias sem uso. **Sair** encerra só a sessão daquele aparelho.
- **Alterar senha** desconecta os outros aparelhos. **Redefinir senha** (por código) desconecta todos.
- Código de recuperação: 6 dígitos, vale 15 min, no máximo 5 tentativas, uso único. A resposta é igual exista ou não a conta.
- Limite de tentativas erradas: 10 por e-mail e 50 por IP a cada 15 min (o IP real vem do header `CF-Connecting-IP` da Cloudflare).
- Se a sessão expirar com alterações offline pendentes, elas são mantidas e enviadas assim que você entra de novo na mesma conta.

## Como funciona a sincronização

Cada alteração (dívida, pagamento, remoção, etc.) é um registro imutável com ID e data/hora. O saldo é sempre recalculado a partir desse histórico.

1. A cada comando de voz ou edição, o aparelho grava a alteração, regera a planilha local e **sobrescreve o backup** (um arquivo só, sempre o mais recente).
2. Com conexão, a alteração sobe para o servidor, que também **regera a planilha** dele.
3. Offline (ou com o servidor fora do ar), as alterações ficam na fila. Um ponto no ícone do lápis avisa que há pendências.
4. Quando a conexão volta, o app envia o que está pendente e recebe o que mudou no servidor. Os dois históricos são **unidos** (não é "um sobrescreve o outro"), então nada se perde mesmo se houve mudança dos dois lados ou em dois aparelhos.
5. Se o servidor tiver menos histórico que o aparelho (ex.: foi restaurado de um backup antigo), o aparelho reenvia tudo automaticamente.

A planilha tem três abas: **Resumo** (saldo por pessoa, próximo vencimento e situação: atrasado/em aberto/quitado), **Lançamentos** e **Histórico**.

## Estrutura

```
ios/
  MidasBridge.swift  ponte WKWebView ↔ IA do iPhone (Speech, Foundation Models, voz)
  README.md          como instalar no projeto do PWABuilder
shared/              roda no servidor E no aparelho
  ledger.js          histórico de alterações → saldos; merge da sincronização
  commands.js        comando interpretado pela IA do iPhone → alterações + resposta falada
  tools.js           alterações válidas (add_debt, register_payment, ...)
  spreadsheet.js     geração do .xlsx
server/
  index.js           API: login, conta, /sync, /spreadsheet
  auth.js            senhas, sessões, limite de tentativas, e-mail de recuperação
  db.js              SQLite
  assistant.js, qwen.js  IA no servidor (opcional, desligada por padrão)
public/              PWA (HTML/CSS/JS puro, sem build)
test/                testes (node:test)
Dockerfile, docker-compose.yml
```
