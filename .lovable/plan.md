# Integração Zernio (WhatsApp coexistente)

Adicionar em **Configurações → Integrações** um cartão "WhatsApp (Zernio)" para conectar e validar a conta, no mesmo padrão do cartão já existente da Evolution API.

## O que o usuário verá

- Novo cartão **WhatsApp — Zernio** na página de Integrações, com status: Não configurado / Conectado / Erro.
- Botão **Configurar** abre um diálogo com os campos:
  - URL base da API (pré-preenchida, editável)
  - Token / API Key
  - Identificador da instância ou número (conforme o provedor)
  - Número de origem (opcional)
- Botão **Testar conexão** valida as credenciais no servidor e mostra o resultado (válido, chave inválida, instância não encontrada, serviço inacessível).
- Após validar, a configuração fica salva e o cartão passa a mostrar o estado da conexão, com opções de **Editar** e **Desconectar**.
- A chave nunca aparece na interface depois de salva (mascarada), e a validação/salvamento acontecem só no backend.

## Detalhes técnicos

- Nova edge function `validate-zernio-key`, espelhando `validate-evolution-key`:
  - valida o JWT do usuário, confere se o `org_id` enviado é o do perfil dele;
  - chama o endpoint de status/conta da Zernio com o token;
  - em caso de sucesso, grava o token em `org_secrets` (`key_name: 'zernio_api_key'`) e a configuração em `integration_configs` (`provider: 'zernio'`) via service role;
  - retorna `{ valid, state }` ou um código de erro (`invalid_key`, `instance_not_found`, `unreachable`, `upstream_error`).
- Novo componente `ZernioCard` em `src/pages/Integrations.tsx` (ou arquivo próprio), lendo `integration_configs` por `provider = 'zernio'`.
- Sem alterações de schema: as tabelas `org_secrets` e `integration_configs` já suportam novos provedores.
- Envio/recebimento de mensagens e o pareamento por QR Code ficam fora desta etapa.

## Pendência antes de implementar

Preciso do endereço da API da Zernio (link da documentação ou o endpoint de verificação de credenciais). Sem isso, a validação fica com uma URL base configurável e um endpoint genérico de status, que talvez precise de ajuste depois.
