<?php
declare(strict_types=1);

namespace Depo\Service;

use Depo\Core\HttpException;

/**
 * FAZ 2.3 — Fotoğraftan parça tanıma (sunucu-tarafı Anthropic proxy).
 *
 * GÜVENLİK (CLAUDE.md §6): API anahtarı YALNIZCA sunucuda config.php['ai']['api_key'].
 * Frontend anahtarı ASLA görmez. İstemci base64 görsel yollar, sunucu Anthropic'e
 * iletir, dönen ÖNERİYİ (attributes/mpn/category_code) verir — SKU'yu istemci üretir.
 *
 * GRACEFUL DEGRADATION: anahtar/enabled yoksa exception fırlatmaz; identify()
 * ['ai_enabled'=>false, 'reason'=>'ai_disabled'] döner → testler/CI yeşil kalır,
 * kullanıcı nazik uyarı görür. Bu ortamda ağ (api.anthropic.com) doğrulanamadı.
 */
final class AiIdentifyService
{
    public function __construct(private readonly array $config) {}

    /** İki kademeli bayrak: enabled=true VE api_key dolu olmalı. */
    public function isConfigured(): bool
    {
        $ai = $this->config['ai'] ?? [];
        return !empty($ai['enabled']) && is_string($ai['api_key'] ?? null) && ($ai['api_key'] !== '');
    }

    /**
     * @param string $imageBase64 base64 görsel (data: öneki OLMADAN)
     * @param string $mediaType   image/jpeg | image/png | image/webp
     * @return array<string,mixed>
     */
    public function identify(string $imageBase64, string $mediaType): array
    {
        if (!$this->isConfigured()) {
            return ['ai_enabled' => false, 'reason' => 'ai_disabled'];
        }
        if ($imageBase64 === '' || strlen($imageBase64) > 8_000_000) {
            throw HttpException::unprocessable('Görsel eksik veya çok büyük');
        }
        $allowed = ['image/jpeg', 'image/png', 'image/webp'];
        if (!in_array($mediaType, $allowed, true)) {
            throw HttpException::unprocessable('Desteklenmeyen görsel türü');
        }

        $ai = $this->config['ai'];
        $model = (string) ($ai['model'] ?? 'claude-sonnet-5');
        $prompt = 'Bu bir elektronik/atölye parçası fotoğrafı. JSON döndür: '
            . '{"name":"kısa Türkçe ad","category_code":"tahmini kategori kodu ya da null",'
            . '"attributes":{"anahtar":"değer"},"mpn":"görünen parça no ya da null",'
            . '"manufacturer":"üretici ya da null","confidence":0-1 arası}. '
            . 'SADECE JSON, açıklama yok. Emin değilsen confidence düşük ver.';

        $payload = [
            'model' => $model,
            'max_tokens' => 512,
            'messages' => [[
                'role' => 'user',
                'content' => [
                    ['type' => 'image', 'source' => ['type' => 'base64', 'media_type' => $mediaType, 'data' => $imageBase64]],
                    ['type' => 'text', 'text' => $prompt],
                ],
            ]],
        ];

        $resp = $this->callAnthropic($ai['api_key'], $payload);
        // Anthropic yanıtından metni çıkar → JSON öneriyi ayrıştır.
        $text = '';
        foreach ($resp['content'] ?? [] as $block) {
            if (($block['type'] ?? '') === 'text') {
                $text .= $block['text'] ?? '';
            }
        }
        $suggestion = $this->extractJson($text);
        return ['ai_enabled' => true, 'suggestion' => $suggestion, 'raw' => $text];
    }

    /** Ham HTTPS POST (cURL). Anthropic SDK/Composer YOK (CLAUDE.md §2). */
    private function callAnthropic(string $apiKey, array $payload): array
    {
        $ch = curl_init('https://api.anthropic.com/v1/messages');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_TIMEOUT => 30,
            CURLOPT_HTTPHEADER => [
                'content-type: application/json',
                'x-api-key: ' . $apiKey,
                'anthropic-version: 2023-06-01',
            ],
            CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE),
        ]);
        $body = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = curl_error($ch);
        curl_close($ch);
        if ($body === false || $code >= 400) {
            throw HttpException::unprocessable('AI servisi yanıt vermedi (' . ($err ?: (string) $code) . ')');
        }
        $decoded = json_decode((string) $body, true);
        return is_array($decoded) ? $decoded : [];
    }

    /** Metinden ilk JSON nesnesini güvenle ayıklar. */
    private function extractJson(string $text): ?array
    {
        $start = strpos($text, '{');
        $end = strrpos($text, '}');
        if ($start === false || $end === false || $end < $start) {
            return null;
        }
        $json = substr($text, $start, $end - $start + 1);
        $decoded = json_decode($json, true);
        return is_array($decoded) ? $decoded : null;
    }
}
