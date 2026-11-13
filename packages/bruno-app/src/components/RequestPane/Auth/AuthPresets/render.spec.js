import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider, useSelector } from 'react-redux';
import { ThemeProvider } from 'styled-components';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import themes from 'themes';
import { ThemeContext } from 'providers/Theme';
import collectionsReducer, { updateRequestAuthMode } from 'providers/ReduxStore/slices/collections';
import 'codemirror/addon/mode/overlay';
import Auth from '../index';
import WSAuth from '../../WSRequestPane/WSAuth';
import AuthPresets from './index';

jest.mock('platform', () => ({ os: { family: 'Windows' } }));

describe('AuthPresets rendering', () => {
  beforeAll(() => {
    Range.prototype.getBoundingClientRect = () => ({ left: 0, right: 0, top: 0, bottom: 0 });
    Range.prototype.getClientRects = () => [];
  });

  afterAll(() => {
    delete Range.prototype.getBoundingClientRect;
    delete Range.prototype.getClientRects;
  });
  it('renders the Bearer preset selector using the real menu and button', async () => {
    const store = configureStore({ reducer: (state = {}) => state });
    render(
      <Provider store={store}>
        <ThemeProvider theme={themes.light}>
          <AuthPresets authMode="bearer" collection={{ uid: 'collection' }} updateAuth={() => ({ type: 'test' })} />
        </ThemeProvider>
      </Provider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Apply Auth Preset' }));
    expect(await screen.findByRole('menuitem', { name: 'auth_token' })).toBeInTheDocument();
  });

  it('switches from No Auth to Bearer with the actual auth view', async () => {
    const collection = {
      uid: 'collection',
      items: [{ uid: 'item', type: 'http-request', request: { auth: { mode: 'none' } } }]
    };
    const store = configureStore({
      reducer: { collections: collectionsReducer, app: (state = { preferences: {} }) => state },
      preloadedState: { collections: { collections: [collection] } }
    });
    const ConnectedAuth = () => {
      const currentCollection = useSelector((state) => state.collections.collections[0]);
      return <Auth item={currentCollection.items[0]} collection={currentCollection} />;
    };
    render(
      <Provider store={store}>
        <ThemeContext.Provider value={{ storedTheme: 'light', theme: themes.light }}>
          <ThemeProvider theme={themes.light}>
            <ConnectedAuth />
          </ThemeProvider>
        </ThemeContext.Provider>
      </Provider>
    );
    fireEvent.click(screen.getByTestId('auth-mode-label'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Bearer Token' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Apply Auth Preset' })).toBeInTheDocument());
    expect(screen.getByText('Token')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Apply Auth Preset' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'auth_token' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    act(() => {
      store.dispatch(updateRequestAuthMode({ itemUid: 'item', collectionUid: 'collection', mode: 'oauth2' }));
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Apply Auth Preset' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Client Credentials' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(store.getState().collections.collections[0].items[0].draft.request.auth.oauth2)
      .toMatchObject({ grantType: 'client_credentials', clientId: '{{oauth_client_id}}' });
    expect(screen.getByText('Client Credentials')).toBeInTheDocument();
  });

  it('does not offer OAuth presets for WebSocket requests', () => {
    const item = { uid: 'item', type: 'ws-request', request: { auth: { mode: 'oauth2' } } };
    const collection = { uid: 'collection', items: [item] };
    const store = configureStore({ reducer: (state = {}) => state });
    render(
      <Provider store={store}>
        <ThemeProvider theme={themes.light}>
          <WSAuth item={item} collection={collection} />
        </ThemeProvider>
      </Provider>
    );
    expect(screen.getByText(/supported by WebSockets/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply Auth Preset' })).not.toBeInTheDocument();
  });
});
