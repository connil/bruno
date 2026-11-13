import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { fireEvent, render, screen } from '@testing-library/react';
import { itemSchema } from '@usebruno/schema';
import collectionsReducer, { updateAuth, updateCollectionAuth, updateFolderAuth } from 'providers/ReduxStore/slices/collections';
import AuthPresets from './index';

jest.mock('platform', () => ({ os: { family: 'Windows' } }));
jest.mock('components/Dropdown', () => ({ icon, children, visible }) => <>{icon}{visible && children}</>);
jest.mock('ui/MenuDropdown/StyledWrapper', () => ({ children }) => <div>{children}</div>);
jest.mock('ui/Button', () => ({ children, onClick, 'aria-expanded': expanded, 'aria-haspopup': hasPopup }) => (
  <button onClick={onClick} aria-expanded={expanded} aria-haspopup={hasPopup}>{children}</button>
));
jest.mock('components/Modal', () => ({ children, handleConfirm, handleCancel }) => (
  <div role="dialog">
    {children}
    <button onClick={handleConfirm}>Apply</button>
    <button onClick={handleCancel}>Cancel</button>
  </div>
));

const setup = (scope, mode, type = 'http-request') => {
  const request = { url: 'https://edited.example.com', auth: { mode }, headers: [{ name: 'Edited' }] };
  const item = scope === 'folder'
    ? { uid: 'item', type: 'folder', items: [], root: { request } }
    : { uid: 'item', type, request };
  const collection = {
    uid: 'collection',
    root: { request },
    items: scope === 'collection' ? [] : [item]
  };
  const store = configureStore({
    reducer: { collections: collectionsReducer },
    preloadedState: { collections: { collections: [collection] } }
  });
  const updateFolder = ({ itemUid, ...payload }) => updateFolderAuth({ ...payload, folderUid: itemUid });
  const update = scope === 'collection' ? updateCollectionAuth : scope === 'folder' ? updateFolder : updateAuth;
  const props = { authMode: mode, collection, ...(scope === 'collection' ? {} : { item }), updateAuth: update };
  const view = render(<Provider store={store}><AuthPresets {...props} /></Provider>);
  return { store, view, props, request };
};

const openPresets = () => fireEvent.click(screen.getByRole('button', { name: 'Apply Auth Preset' }));

describe('authentication presets', () => {
  it('shows only presets for the selected method and updates when the method changes', () => {
    const { view, props, store } = setup('request', 'basic');
    expect(screen.getByRole('button', { name: 'Apply Auth Preset' })).toHaveAttribute('aria-expanded', 'false');
    openPresets();
    expect(screen.getByRole('button', { name: 'Apply Auth Preset' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('auth_username / auth_password')).toBeInTheDocument();
    expect(screen.getByText('username / password')).toBeInTheDocument();
    expect(screen.queryByText('access_token')).not.toBeInTheDocument();

    view.rerender(<Provider store={store}><AuthPresets {...props} authMode="bearer" /></Provider>);
    expect(screen.getByText('auth_token')).toBeInTheDocument();
    expect(screen.getByText('access_token')).toBeInTheDocument();
    expect(screen.queryByText('username / password')).not.toBeInTheDocument();

    view.rerender(<Provider store={store}><AuthPresets {...props} authMode="inherit" /></Provider>);
    expect(screen.queryByRole('button', { name: 'Apply Auth Preset' })).not.toBeInTheDocument();
  });

  it.each([
    ['request', 'basic', 'username / password', { mode: 'basic', basic: { username: '{{username}}', password: '{{password}}' } }],
    ['folder', 'bearer', 'access_token', { mode: 'bearer', bearer: { token: '{{access_token}}' } }],
    ['collection', 'apikey', 'api-key header', { mode: 'apikey', apikey: { key: 'api-key', value: '{{api_key}}', placement: 'header' } }]
  ])('applies the selected %s preset without changing other fields', (scope, mode, label, auth) => {
    const { store } = setup(scope, mode);
    openPresets();
    fireEvent.click(screen.getByText(label));
    expect(screen.getByRole('dialog')).toHaveTextContent('including unsaved auth changes');
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    const collection = store.getState().collections.collections[0];
    const draft = scope === 'collection' ? collection.draft.root : collection.items[0].draft;
    expect(draft.request).toMatchObject({ url: 'https://edited.example.com', headers: [{ name: 'Edited' }], auth });
  });

  it('leaves auth unchanged when a preset is cancelled', () => {
    const { store, request } = setup('request', 'bearer', 'ws-request');
    openPresets();
    fireEvent.click(screen.getByText('auth_token'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(store.getState().collections.collections[0].items[0].request).toEqual(request);
    expect(store.getState().collections.collections[0].items[0].draft).toBeUndefined();
  });

  it.each(['http-request', 'graphql-request', 'grpc-request', 'ws-request'])('applies a bearer preset to %s', (type) => {
    const { store } = setup('request', 'bearer', type);
    openPresets();
    fireEvent.click(screen.getByText('auth_token'));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(store.getState().collections.collections[0].items[0].draft.request.auth)
      .toMatchObject({ mode: 'bearer', bearer: { token: '{{auth_token}}' } });
  });

  it.each([
    ['Authorization Code with PKCE', 'authorization_code', { pkce: true, authorizationUrl: '{{oauth_authorization_url}}' }],
    ['Authorization Code', 'authorization_code', { pkce: false, clientSecret: '{{oauth_client_secret}}' }],
    ['Client Credentials', 'client_credentials', { clientSecret: '{{oauth_client_secret}}' }],
    ['Password Credentials (legacy)', 'password', { username: '{{oauth_username}}', password: '{{oauth_password}}' }],
    ['Implicit (legacy)', 'implicit', { authorizationUrl: '{{oauth_authorization_url}}' }]
  ])('applies and validates the %s OAuth preset', (label, grantType, fields) => {
    const { store } = setup('request', 'oauth2');
    openPresets();
    fireEvent.click(screen.getByText(label));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    const auth = store.getState().collections.collections[0].items[0].draft.request.auth;
    expect(auth.oauth2).toMatchObject({ grantType, clientId: '{{oauth_client_id}}', ...fields });
    const validated = itemSchema.validateSync({
      uid: '123456789012345678901', name: 'Request', type: 'http-request',
      request: { url: 'https://example.com', method: 'GET', headers: [], params: [], body: { mode: 'none' }, auth }
    });
    expect(validated.request.auth.oauth2).toMatchObject(auth.oauth2);
  });

  it.each([
    ['request', 'grpc-request'],
    ['folder', 'folder'],
    ['collection', 'http-request']
  ])('applies OAuth to %s without losing other draft changes', (scope, type) => {
    const { store } = setup(scope, 'oauth2', type);
    openPresets();
    fireEvent.click(screen.getByText('Client Credentials'));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    const collection = store.getState().collections.collections[0];
    const draft = scope === 'collection' ? collection.draft.root : collection.items[0].draft;
    expect(draft.request).toMatchObject({
      url: 'https://edited.example.com',
      headers: [{ name: 'Edited' }],
      auth: { mode: 'oauth2', oauth2: { grantType: 'client_credentials', accessTokenUrl: '{{oauth_token_url}}' } }
    });
  });

  it('does not replace OAuth settings when cancelled', () => {
    const { store } = setup('request', 'oauth2');
    openPresets();
    fireEvent.click(screen.getByText('Client Credentials'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(store.getState().collections.collections[0].items[0].draft).toBeUndefined();
  });

  it('replaces only the selected OAuth configuration and preserves other auth drafts', () => {
    const { store } = setup('request', 'oauth2');
    store.dispatch(updateAuth({ collectionUid: 'collection', itemUid: 'item', mode: 'bearer', content: { token: 'edited-token' } }));
    store.dispatch(updateAuth({ collectionUid: 'collection', itemUid: 'item', mode: 'oauth2', content: { grantType: 'password', password: 'old-password' } }));
    openPresets();
    fireEvent.click(screen.getByText('Client Credentials'));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    const auth = store.getState().collections.collections[0].items[0].draft.request.auth;
    expect(auth.bearer).toEqual({ token: 'edited-token' });
    expect(auth.oauth2).toMatchObject({ grantType: 'client_credentials' });
    expect(auth.oauth2).not.toHaveProperty('password');
  });
});
