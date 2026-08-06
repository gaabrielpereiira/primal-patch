# Aba de Chat — WhatsApp via Zernio

Caixa de entrada de WhatsApp dentro do app: lista de conversas, histórico de mensagens, resposta em tempo real e vínculo automático com pacientes/contatos pelo telefone.

## O que o usuário vai ver

- Novo item **Chat** no menu lateral (rota `/chat` e `/chat/:conversationId`).
- Coluna esquerda: lista de conversas com foto/nome, última mensagem, horário e contador de não lidas, com busca.
- Painel direito: histórico da conversa (balões enviados/recebidos), cabeçalho com nome, telefone e link para o cadastro do paciente quando houver correspondência.
- Campo de resposta com envio de texto; mensagens novas aparecem sozinhas, sem recarregar.
- Aviso quando a janela de 24h do WhatsApp estiver fechada (a Meta só permite reabrir com modelo aprovado) — nesse caso o campo de envio fica bloqueado com explicação.
- Estado vazio orientando a conectar o WhatsApp em Integrações quando ainda não há conexão Zernio.

## Como as mensagens chegam

Zernio envia um webhook para o app a cada mensagem recebida/enviada. O app grava no banco e a tela atualiza em tempo real. O webhook é registrado automaticamente na Zernio a partir do cartão de Integrações, com um segredo de assinatura próprio por organização.

## Detalhes técnicos

### Banco (migração)

- `whatsapp_conversations`: `org_id`, `zernio_conversation_id` (único), `zernio_account_id`, `phone`, `display_name`, `avatar_url`, `patient_id` (FK opcional), `contact_id` (FK opcional), `last_message_at`, `last_message_preview`, `unread_count`, `last_inbound_at` (para a janela de 24h), timestamps.
- `whatsapp_messages`: `org_id`, `conversation_id` (FK), `zernio_message_id` (único), `direction` (`inbound`/`outbound`), `body`, `media_url`, `media_type`, `status`, `sent_at`, `sent_by` (perfil, quando enviado pelo app), `raw` jsonb, `created_at`.
- `zernio_webhook_events`: `event_id` único para deduplicação (entrega é at-least-once).
- Em `integration_configs` (provider `zernio_whatsapp`) passam a ser guardados: `webhook_token`, `account_id` e status do registro do webhook. O segredo HMAC vai para `org_secrets`.
- GRANTs para `authenticated` (SELECT/INSERT/UPDATE) e `service_role` (ALL); RLS por `org_id = public.current_org_id()`; `zernio_webhook_events` só acessível pelo `service_role`.
- Realtime habilitado para `whatsapp_conversations` e `whatsapp_messages`.

### Edge functions

1. `zernio-webhook` (público, sem JWT):
   - URL com token da organização: `.../zernio-webhook?t=<webhook_token>`.
   - Valida `X-Zernio-Signature` (HMAC-SHA256 hex do corpo bruto com o segredo da org).
   - Deduplica por `X-Zernio-Event-Id`, responde 2xx rápido.
   - Trata `message.received`, `message.sent`, `account.connected`, `account.disconnected`.
   - Faz upsert da conversa e da mensagem; normaliza o telefone (E.164 e variação com/sem o 9 no Brasil) e vincula a `patients.phone` / `contacts.phone` quando encontrar.
2. `zernio-connect` (já existente) ganha as ações:
   - `register_webhook` / `unregister_webhook` via `POST|DELETE /v1/webhooks/settings`, assinando `message.received`, `message.sent`, `account.connected`, `account.disconnected`.
   - `list_conversations` e `list_messages` (`GET /v1/inbox/conversations`, `GET /v1/inbox/conversations/{id}/messages`) para carga inicial do histórico.
   - `send_message` (`POST /v1/inbox/conversations/{id}/messages`) e `mark_read` (`POST /v1/inbox/conversations/{id}/read`).
   - Todas validam JWT, resolvem `org_id` pelo perfil do usuário e leem a API key de `org_secrets` — a chave nunca vai para o navegador.

### Frontend

- `src/pages/Chat.tsx` + componentes em `src/components/chat/`: `ConversationList`, `ConversationHeader`, `MessageList`, `MessageComposer`.
- Rota `/chat/:conversationId?` em `App.tsx` (dentro das rotas protegidas) e item **Chat** no `AppSidebar`.
- Leitura das conversas/mensagens direto das tabelas via cliente do app, com assinatura Realtime (canal por `org_id`, encerrado no unmount).
- Envio otimista: a mensagem aparece imediatamente e é reconciliada quando o webhook confirma.
- Botão de sincronizar histórico (chama `list_conversations`/`list_messages`) para trazer conversas anteriores à conexão.

### Integrações

O cartão Zernio ganha a seção "Caixa de entrada": mostra a URL do webhook, botão para registrar/remover na Zernio e o status do registro.

## Fora do escopo desta versão

- Envio de mídia/áudio, modelos aprovados (templates) e reabertura da janela de 24h.
- Atribuição de conversas a atendentes, tags e respostas rápidas.
