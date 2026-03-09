import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'cyrus_brain_config';

export interface BrainConfig {
  host: string;
  port: number;
}

const DEFAULT_CONFIG: BrainConfig = { host: '192.168.1.100', port: 8769 };

export async function loadConfig(): Promise<BrainConfig> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return DEFAULT_CONFIG;
}

export async function saveConfig(config: BrainConfig): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

interface Props {
  config: BrainConfig;
  onSave: (config: BrainConfig) => void;
  onClose: () => void;
}

export default function Settings({ config, onSave, onClose }: Props) {
  const [host, setHost] = useState(config.host);
  const [port, setPort] = useState(String(config.port));

  const handleSave = async () => {
    const cfg: BrainConfig = { host: host.trim(), port: parseInt(port, 10) || 8768 };
    await saveConfig(cfg);
    onSave(cfg);
    onClose();
  };

  return (
    <KeyboardAvoidingView
      style={styles.overlay}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.card}>
        <Text style={styles.title}>Brain Connection</Text>

        <Text style={styles.label}>Host (IP address)</Text>
        <TextInput
          style={styles.input}
          value={host}
          onChangeText={setHost}
          placeholder="192.168.1.100"
          placeholderTextColor="#666"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="default"
        />

        <Text style={styles.label}>Port</Text>
        <TextInput
          style={styles.input}
          value={port}
          onChangeText={setPort}
          placeholder="8768"
          placeholderTextColor="#666"
          keyboardType="number-pad"
        />

        <View style={styles.buttons}>
          <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
            <Text style={styles.saveText}>Save & Connect</Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: '#1e1e1e',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 400,
  },
  title: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 20,
  },
  label: {
    color: '#aaa',
    fontSize: 13,
    marginBottom: 6,
    marginTop: 12,
  },
  input: {
    backgroundColor: '#2a2a2a',
    borderRadius: 10,
    padding: 14,
    color: '#fff',
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#333',
  },
  buttons: {
    flexDirection: 'row',
    marginTop: 24,
    gap: 12,
  },
  cancelBtn: {
    flex: 1,
    padding: 14,
    borderRadius: 10,
    backgroundColor: '#333',
    alignItems: 'center',
  },
  cancelText: { color: '#aaa', fontSize: 15, fontWeight: '600' },
  saveBtn: {
    flex: 1,
    padding: 14,
    borderRadius: 10,
    backgroundColor: '#4a9eff',
    alignItems: 'center',
  },
  saveText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
