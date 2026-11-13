import React, { useState } from 'react';
import { useDispatch } from 'react-redux';
import { IconCaretDown } from '@tabler/icons';
import Modal from 'components/Modal';
import MenuDropdown from 'ui/MenuDropdown';
import Button from 'ui/Button';

const oauth2Defaults = {
  scope: '{{oauth_scope}}',
  credentialsPlacement: 'body',
  credentialsId: 'credentials',
  tokenPlacement: 'header',
  tokenHeaderPrefix: 'Bearer',
  tokenQueryKey: 'access_token',
  tokenSource: 'access_token'
};

const presetsByMode = {
  basic: [
    { id: 'auth-credentials', label: 'auth_username / auth_password', content: { username: '{{auth_username}}', password: '{{auth_password}}' } },
    { id: 'credentials', label: 'username / password', content: { username: '{{username}}', password: '{{password}}' } }
  ],
  bearer: [
    { id: 'auth-token', label: 'auth_token', content: { token: '{{auth_token}}' } },
    { id: 'access-token', label: 'access_token', content: { token: '{{access_token}}' } }
  ],
  apikey: [
    { id: 'x-api-key', label: 'X-API-Key header', content: { key: 'X-API-Key', value: '{{api_key}}', placement: 'header' } },
    { id: 'api-key', label: 'api-key header', content: { key: 'api-key', value: '{{api_key}}', placement: 'header' } }
  ],
  oauth2: [
    {
      id: 'authorization-code-pkce',
      label: 'Authorization Code with PKCE',
      content: { ...oauth2Defaults, grantType: 'authorization_code', authorizationUrl: '{{oauth_authorization_url}}', accessTokenUrl: '{{oauth_token_url}}', clientId: '{{oauth_client_id}}', pkce: true, autoFetchToken: true }
    },
    {
      id: 'authorization-code',
      label: 'Authorization Code',
      content: { ...oauth2Defaults, grantType: 'authorization_code', authorizationUrl: '{{oauth_authorization_url}}', accessTokenUrl: '{{oauth_token_url}}', clientId: '{{oauth_client_id}}', clientSecret: '{{oauth_client_secret}}', pkce: false, autoFetchToken: true }
    },
    {
      id: 'client-credentials',
      label: 'Client Credentials',
      content: { ...oauth2Defaults, grantType: 'client_credentials', accessTokenUrl: '{{tokenUrl}}', clientId: '{{clientId}}', clientSecret: '{{clientSecret}}' }
    },
    {
      id: 'password',
      label: 'Password Credentials (legacy)',
      content: { ...oauth2Defaults, grantType: 'password', accessTokenUrl: '{{oauth_token_url}}', clientId: '{{oauth_client_id}}', clientSecret: '{{oauth_client_secret}}', username: '{{oauth_username}}', password: '{{oauth_password}}' }
    },
    {
      id: 'implicit',
      label: 'Implicit (legacy)',
      content: { ...oauth2Defaults, grantType: 'implicit', authorizationUrl: '{{oauth_authorization_url}}', clientId: '{{oauth_client_id}}', autoFetchToken: true }
    }
  ]
};

const AuthPresets = ({ authMode, collection, item, updateAuth }) => {
  const dispatch = useDispatch();
  const [selectedPresetId, setSelectedPresetId] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const presets = presetsByMode[authMode] || [];
  const selectedPreset = presets.find((preset) => preset.id === selectedPresetId);

  if (!presets.length) return null;

  const applyPreset = (preset) => {
    dispatch(updateAuth({
      mode: authMode,
      collectionUid: collection.uid,
      ...(item ? { itemUid: item.uid } : {}),
      content: { ...preset.content }
    }));
    setSelectedPresetId(null);
  };

  return (
    <>
      <div className="mt-2">
        <MenuDropdown
          items={presets.map((preset) => ({
            id: preset.id,
            label: preset.label,
            onClick: () => setSelectedPresetId(preset.id)
          }))}
          opened={menuOpen}
          onChange={setMenuOpen}
          placement="bottom-start"
          appendTo={() => document.body}
          hideOnReferenceClip={true}
          data-testid="auth-presets"
        >
          <span className="inline-flex">
            <Button size="sm" variant="outline" icon={<IconCaretDown size={14} />} iconPosition="right" aria-haspopup="menu" aria-expanded={menuOpen}>
              Apply Auth Preset
            </Button>
          </span>
        </MenuDropdown>
      </div>
      {selectedPreset && (
        <Modal
          size="md"
          title="Apply Auth Preset"
          confirmText="Apply"
          handleConfirm={() => applyPreset(selectedPreset)}
          handleCancel={() => setSelectedPresetId(null)}
          dataTestId="apply-auth-preset"
        >
          <p>Apply {selectedPreset.label}? This replaces the current authentication configuration, including unsaved auth changes.</p>
          <p className="mt-2">Set the preset&apos;s credential variables in an environment or edit them in the Auth tab, then save the changes.</p>
        </Modal>
      )}
    </>
  );
};

export default AuthPresets;
