# Integração Zernio — WhatsApp coexistente

Novo cartão em **Configurações → Integrações** para conectar a conta Zernio e vincular o número de WhatsApp (incluindo números em modo coexistência, que continuam funcionando no app WhatsApp Business do celular).

Escopo desta etapa: **conectar e validar**. Envio/recebimento de mensagens fica para depois.

## Fluxo na interface

Cartão **WhatsApp (Zernio)**, no mesmo padrão do cartão da Evolution API já existente:

1. **Não configurado** → botão "Conectar".
2. Diálogo pede a **API Key da Zernio** (`sk_…`, criada em Zernio → Settings → API Keys). Ao salvar, o app valida a chave no servidor e mostra erro claro se for inválida.
3. Com a chave válida, o app lista os **perfis (profiles)** da conta Zernio e permite escolher um existente ou criar um novo para a clínica.
4. Botão **"Conectar WhatsApp"** abre o fluxo oficial de autorização da Zernio/Meta em nova aba. É aí que o número em coexistência é pareado.
5. Ao voltar para o app, o cartão mostra o **número conectado, nome da conta e status** (ativo / com problema), com ações **Reconectar**, **Atualizar status** e **Desconectar**.
6. Se a conta do WhatsApp tiver mais de um número, o app exibe a lista para o usuário escolher qual vincular.

A chave nunca é exibida depois de salva (só os últimos caracteres) e nunca é enviada ao navegador.

## Detalhes técnicos

API Zernio — base `https://zernio.com/api/v1`, autenticação `Authorization: Bearer sk_…`:

- `GET /v1/auth/verify` — validação da chave (retorna `valid`, `userId`, `authType`).
- `GET /v1/profiles` e `POST /v1/profiles` — listar/criar perfil.
- `GET /v1/connect/whatsapp?profileId=…&redirect_url=…` — retorna `authUrl` para abrir o consentimento; o `redirect_url` volta para `…/settings/integrations?connected=whatsapp`.
- `GET|POST /v1/connect/whatsapp/select-phone-number` — só quando a conta tem 2+ números.
- `GET /v1/accounts?profileId=…` + `GET /v1/accounts/{id}/health` — status exibido no cartão.

Implementação:

- Nova edge function **`zernio-connect`** (espelhando `validate-evolution-key`): valida o JWT do usuário, confere o `org_id` do perfil, e expõe as ações `verify`, `list_profiles`, `create_profile`, `connect_url`, `list_phone_numbers`, `select_phone_number`, `list_accounts`, `disconnect`. Todas as chamadas à Zernio saem daqui, nunca do navegador.
- A chave fica em `org_secrets` (`key_name: 'zernio_api_key'`); o restante (profileId, accountId, número, status, última verificação) em `integration_configs` com `provider: 'zernio_whatsapp'`. Sem mudanças de schema.
- Novo componente `ZernioWhatsAppCard` (arquivo próprio em `src/components/settings/`), renderizado na página de Integrações ao lado do cartão da Evolution API.
- A página de Integrações passa a ler o parâmetro `?connected=whatsapp` no retorno do OAuth para atualizar o status e mostrar o resultado.
- Erros da Zernio são repassados com mensagem legível — chave inválida (401), perfil inexistente (404) e limite de plano/pagamento (402) têm textos próprios.

## Observações

- Números em coexistência não suportam alguns recursos da Zernio (grupos, flows, alguns envios). Isso não afeta esta etapa, mas vale considerar quando formos ligar o envio de mensagens.
- O cartão atual da Evolution API continua existindo; as duas integrações convivem, e o usuário escolhe qual usar.
