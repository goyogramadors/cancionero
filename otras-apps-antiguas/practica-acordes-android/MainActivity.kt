package com.example

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.filled.VolumeUp
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlin.math.sin

// Theme Colors
val Slate950 = Color(0xFF020617) // Deep cosmic slate bg
val Slate900 = Color(0xFF0F172A) // Slate bg/panel border
val Slate800 = Color(0xFF1E293B) // Active panels/borders
val Slate700 = Color(0xFF334155) // Inactive borders
val Slate600 = Color(0xFF475569) // Silent text/accent
val Slate500 = Color(0xFF64748B) // Subtitle label
val Emerald500 = Color(0xFF10B981) // Glowing primary
val Emerald400 = Color(0xFF34D399) // Clean accent light emerald
val Blue500 = Color(0xFF3B82F6) // Dynamic visual blue
val Blue400 = Color(0xFF60A5FA) // Accent light blue
val Rose600 = Color(0xFFE11D48) // STOP active rose/red
val Rose700 = Color(0xFFBE123C) // STOP pressed rose
val Amber500 = Color(0xFFF59E0B) // Warn/Highlight accent
val Red500 = Color(0xFFEF4444)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            MaterialTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = Slate950
                ) {
                    ChordPracticeApp()
                }
            }
        }
    }
}

// Model representing a musical chord
data class Chord(
    val root: String,
    val suffix: String,
    val bass: String?, // Modified bass for inversions (e.g. "/E")
    val degree: String?, // Roman numeral degree (e.g. "IV", "ii")
    val noteSemitones: List<Int> // intervals relative to root, e.g. [0, 4, 7]
)

// Data structure for scale degree rules
data class ScaleDegreeInfo(
    val degreeName: String,
    val semitoneOffset: Int,
    val isMinor: Boolean,
    val isDiminished: Boolean,
    val defaultSuffix: String,
    val seventhSuffix: String
)

// Standard diatonic scale configurations
val majorDegrees = listOf(
    ScaleDegreeInfo("I", 0, false, false, "", "maj7"),
    ScaleDegreeInfo("ii", 2, true, false, "m", "m7"),
    ScaleDegreeInfo("iii", 4, true, false, "m", "m7"),
    ScaleDegreeInfo("IV", 5, false, false, "", "maj7"),
    ScaleDegreeInfo("V", 7, false, false, "", "7"),
    ScaleDegreeInfo("vi", 9, true, false, "m", "m7"),
    ScaleDegreeInfo("vii°", 11, false, true, "dim", "m7b5")
)

val minorDegrees = listOf(
    ScaleDegreeInfo("i", 0, true, false, "m", "m7"),
    ScaleDegreeInfo("ii°", 2, false, true, "dim", "m7b5"),
    ScaleDegreeInfo("III", 3, false, false, "", "maj7"),
    ScaleDegreeInfo("iv", 5, true, false, "m", "m7"),
    ScaleDegreeInfo("v", 7, true, false, "m", "m7"),
    ScaleDegreeInfo("VI", 8, false, false, "", "maj7"),
    ScaleDegreeInfo("VII", 10, false, false, "", "7")
)

// Helper functions for chord logic
fun getSemitone(note: String): Int {
    return when (note) {
        "C" -> 0
        "C#" -> 1
        "D" -> 2
        "Eb" -> 3
        "E" -> 4
        "F" -> 5
        "F#" -> 6
        "G" -> 7
        "Ab" -> 8
        "A" -> 9
        "Bb" -> 10
        "B" -> 11
        else -> 0
    }
}

fun getNoteFromSemitone(semitone: Int): String {
    val norm = (semitone % 12 + 12) % 12
    val defaultChromatics = listOf("C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B")
    return defaultChromatics[norm]
}

fun getNoteNameLatin(note: String): String {
    return when (note) {
        "C" -> "Do"
        "C#" -> "Do#"
        "D" -> "Re"
        "Eb" -> "Mib"
        "E" -> "Mi"
        "F" -> "Fa"
        "F#" -> "Fa#"
        "G" -> "Sol"
        "Ab" -> "Lab"
        "A" -> "La"
        "Bb" -> "Sib"
        "B" -> "Si"
        else -> note
    }
}

fun getChordIntervals(suffix: String): List<Int> {
    return when (suffix) {
        "m" -> listOf(0, 3, 7)
        "dim" -> listOf(0, 3, 6)
        "maj7" -> listOf(0, 4, 7, 11)
        "m7" -> listOf(0, 3, 7, 10)
        "7" -> listOf(0, 4, 7, 10)
        "m7b5" -> listOf(0, 3, 6, 10)
        else -> listOf(0, 4, 7) // Major triad
    }
}

// Metronome click audio synthesizer using AudioTrack
class MetronomeSynth {
    private val sampleRate = 44100
    private val durationMs = 80
    private val numSamples = (sampleRate * durationMs / 1000)
    
    private val beat1Buffer: ShortArray
    private val beat2Buffer: ShortArray
    
    init {
        beat1Buffer = generateClick(1000.0) // high pitch click for beat 1
        beat2Buffer = generateClick(600.0)  // lower pitch click for beats 2, 3, 4
    }
    
    private fun generateClick(frequency: Double): ShortArray {
        val buffer = ShortArray(numSamples)
        for (i in 0 until numSamples) {
            val t = i.toDouble() / sampleRate
            val sine = sin(2.0 * Math.PI * frequency * t)
            // Decay envelope to avoid clicking/popping sounds
            val envelope = (numSamples - i).toDouble() / numSamples
            buffer[i] = (sine * 14000.0 * envelope).toInt().toShort()
        }
        return buffer
    }
    
    fun playClick(isBeat1: Boolean) {
        try {
            val buffer = if (isBeat1) beat1Buffer else beat2Buffer
            val audioTrack = AudioTrack.Builder()
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build()
                )
                .setAudioFormat(
                    AudioFormat.Builder()
                        .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .setSampleRate(sampleRate)
                        .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                        .build()
                )
                .setBufferSizeInBytes(buffer.size * 2)
                .setTransferMode(AudioTrack.MODE_STATIC)
                .build()
                
            audioTrack.write(buffer, 0, buffer.size)
            audioTrack.play()
            
            // Release resources asynchronously after playing
            Thread {
                try {
                    Thread.sleep(durationMs + 50L)
                    audioTrack.stop()
                    audioTrack.release()
                } catch (e: Exception) {
                    // ignore
                }
            }.start()
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }
}

// ViewModel to manage application state and metronome timing
class ChordViewModel : ViewModel() {
    private val synth = MetronomeSynth()
    private var metronomeJob: Job? = null
    
    // Config states
    private val _bpm = MutableStateFlow(60)
    val bpm = _bpm.asStateFlow()
    
    private val _isPlaying = MutableStateFlow(false)
    val isPlaying = _isPlaying.asStateFlow()
    
    private val _beat = MutableStateFlow(1)
    val beat = _beat.asStateFlow()
    
    private val _measuresToChange = MutableStateFlow(1) // 1, 2, or 4 measures
    val measuresToChange = _measuresToChange.asStateFlow()
    
    private val _rootTone = MutableStateFlow("Libre") // "Libre" or notes
    val rootTone = _rootTone.asStateFlow()
    
    private val _scaleMode = MutableStateFlow("Mayor") // "Mayor" or "Menor"
    val scaleMode = _scaleMode.asStateFlow()
    
    private val _isLatin = MutableStateFlow(true) // Latin Do/Re/Mi vs Anglo C/D/E
    val isLatin = _isLatin.asStateFlow()
    
    // Modifiers
    private val _isSharpsActive = MutableStateFlow(true)
    val isSharpsActive = _isSharpsActive.asStateFlow()
    
    private val _isMinorsActive = MutableStateFlow(true)
    val isMinorsActive = _isMinorsActive.asStateFlow()
    
    private val _isSeventhsActive = MutableStateFlow(false)
    val isSeventhsActive = _isSeventhsActive.asStateFlow()
    
    private val _isInversionsActive = MutableStateFlow(false)
    val isInversionsActive = _isInversionsActive.asStateFlow()
    
    // Dynamic chords state
    private val _currentChord = MutableStateFlow<Chord?>(null)
    val currentChord = _currentChord.asStateFlow()
    
    private val _nextChord = MutableStateFlow<Chord?>(null)
    val nextChord = _nextChord.asStateFlow()
    
    private val _measureCount = MutableStateFlow(1)
    val measureCount = _measureCount.asStateFlow()
    
    init {
        regenerateAllChords()
    }
    
    fun setBpm(newBpm: Int) {
        _bpm.value = newBpm.coerceIn(30, 240)
    }
    
    fun setMeasuresToChange(measures: Int) {
        _measuresToChange.value = measures
    }
    
    fun setRootTone(tone: String) {
        _rootTone.value = tone
        onModifierChanged()
    }
    
    fun setScaleMode(mode: String) {
        _scaleMode.value = mode
        onModifierChanged()
    }
    
    fun toggleLatin() {
        _isLatin.value = !_isLatin.value
    }
    
    fun toggleSharps() {
        _isSharpsActive.value = !_isSharpsActive.value
        onModifierChanged()
    }
    
    fun toggleMinors() {
        _isMinorsActive.value = !_isMinorsActive.value
        onModifierChanged()
    }
    
    fun toggleSevenths() {
        _isSeventhsActive.value = !_isSeventhsActive.value
        onModifierChanged()
    }
    
    fun toggleInversions() {
        _isInversionsActive.value = !_isInversionsActive.value
        onModifierChanged()
    }
    
    private fun onModifierChanged() {
        if (_isPlaying.value) {
            updateNextChordOnly()
        } else {
            regenerateAllChords()
        }
    }
    
    fun togglePlay() {
        if (_isPlaying.value) {
            stopPlayback()
        } else {
            startPlayback()
        }
    }
    
    private fun startPlayback() {
        _isPlaying.value = true
        _beat.value = 1
        _measureCount.value = 1
        
        metronomeJob?.cancel()
        metronomeJob = viewModelScope.launch(Dispatchers.Default) {
            var lastBeatTime = System.currentTimeMillis()
            while (isActive) {
                val currentBpm = _bpm.value
                val intervalMs = (60000.0 / currentBpm).toLong()
                
                // Play audio click
                val currentBeat = _beat.value
                synth.playClick(isBeat1 = currentBeat == 1)
                
                // Wait for next beat precisely
                val now = System.currentTimeMillis()
                val nextBeatTime = lastBeatTime + intervalMs
                val delayTime = nextBeatTime - now
                if (delayTime > 0) {
                    delay(delayTime)
                    lastBeatTime = nextBeatTime
                } else {
                    delay(intervalMs)
                    lastBeatTime = System.currentTimeMillis()
                }
                
                // Move to next beat
                val nextBeat = if (currentBeat == 4) 1 else currentBeat + 1
                _beat.value = nextBeat
                
                // If it loops to beat 1, a new measure starts!
                if (nextBeat == 1) {
                    advanceMeasure()
                }
            }
        }
    }
    
    private fun stopPlayback() {
        _isPlaying.value = false
        metronomeJob?.cancel()
        _beat.value = 1
    }
    
    private fun advanceMeasure() {
        val count = _measureCount.value
        val limit = _measuresToChange.value
        if (count >= limit) {
            // Swap current with next and generate next
            _currentChord.value = _nextChord.value
            _nextChord.value = generateChord(
                currentChord = _currentChord.value,
                rootTone = _rootTone.value,
                scaleMode = _scaleMode.value,
                isSharpsActive = _isSharpsActive.value,
                isMinorsActive = _isMinorsActive.value,
                isSeventhsActive = _isSeventhsActive.value,
                isInversionsActive = _isInversionsActive.value
            )
            _measureCount.value = 1
        } else {
            _measureCount.value = count + 1
        }
    }
    
    private fun regenerateAllChords() {
        val first = generateChord(
            currentChord = null,
            rootTone = _rootTone.value,
            scaleMode = _scaleMode.value,
            isSharpsActive = _isSharpsActive.value,
            isMinorsActive = _isMinorsActive.value,
            isSeventhsActive = _isSeventhsActive.value,
            isInversionsActive = _isInversionsActive.value
        )
        val second = generateChord(
            currentChord = first,
            rootTone = _rootTone.value,
            scaleMode = _scaleMode.value,
            isSharpsActive = _isSharpsActive.value,
            isMinorsActive = _isMinorsActive.value,
            isSeventhsActive = _isSeventhsActive.value,
            isInversionsActive = _isInversionsActive.value
        )
        _currentChord.value = first
        _nextChord.value = second
        _measureCount.value = 1
    }
    
    private fun updateNextChordOnly() {
        _nextChord.value = generateChord(
            currentChord = _currentChord.value,
            rootTone = _rootTone.value,
            scaleMode = _scaleMode.value,
            isSharpsActive = _isSharpsActive.value,
            isMinorsActive = _isMinorsActive.value,
            isSeventhsActive = _isSeventhsActive.value,
            isInversionsActive = _isInversionsActive.value
        )
    }
    
    override fun onCleared() {
        super.onCleared()
        metronomeJob?.cancel()
    }
}

// Chord generation logic
fun generateChord(
    currentChord: Chord?,
    rootTone: String,
    scaleMode: String,
    isSharpsActive: Boolean,
    isMinorsActive: Boolean,
    isSeventhsActive: Boolean,
    isInversionsActive: Boolean
): Chord {
    val chromatics = listOf("C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B")
    val naturals = listOf("C", "D", "E", "F", "G", "A", "B")
    
    var generated: Chord? = null
    var attempts = 0
    
    while (generated == null || (currentChord != null && generated.root == currentChord.root && generated.suffix == currentChord.suffix && attempts < 15)) {
        attempts++
        
        if (rootTone == "Libre") {
            // MODO LIBRE: pure random chords
            val pool = if (isSharpsActive) chromatics else naturals
            val root = pool.random()
            
            val isMinor = isMinorsActive && Math.random() < 0.5
            val baseQuality = if (isMinor) "m" else ""
            
            val suffix = if (isSeventhsActive) {
                if (isMinor) {
                    "m7"
                } else {
                    if (Math.random() < 0.5) "maj7" else "7"
                }
            } else {
                baseQuality
            }
            
            val intervals = getChordIntervals(suffix)
            
            // Inversions
            var bass: String? = null
            if (isInversionsActive && Math.random() < 0.6) {
                val chosenIndex = if (Math.random() < 0.5) 1 else 2 // 3rd or 5th
                if (chosenIndex < intervals.size) {
                    val bassSemitone = (getSemitone(root) + intervals[chosenIndex]) % 12
                    bass = chromatics[bassSemitone]
                }
            }
            
            generated = Chord(
                root = root,
                suffix = suffix,
                bass = bass,
                degree = null,
                noteSemitones = intervals
            )
        } else {
            // MODO CAMPO TONAL: diatonic chords inside scale
            val scaleRootSemitone = getSemitone(rootTone)
            val degrees = if (scaleMode == "Mayor") majorDegrees else minorDegrees
            
            val degreeInfo = degrees.random()
            val degreeRootSemitone = (scaleRootSemitone + degreeInfo.semitoneOffset) % 12
            val root = chromatics[degreeRootSemitone]
            
            val suffix = if (isSeventhsActive) {
                degreeInfo.seventhSuffix
            } else {
                degreeInfo.defaultSuffix
            }
            
            val intervals = getChordIntervals(suffix)
            
            // Inversions
            var bass: String? = null
            if (isInversionsActive && Math.random() < 0.6) {
                val chosenIndex = if (Math.random() < 0.5) 1 else 2 // 3rd or 5th
                if (chosenIndex < intervals.size) {
                    val bassSemitone = (getSemitone(root) + intervals[chosenIndex]) % 12
                    bass = chromatics[bassSemitone]
                }
            }
            
            generated = Chord(
                root = root,
                suffix = suffix,
                bass = bass,
                degree = degreeInfo.degreeName,
                noteSemitones = intervals
            )
        }
    }
    
    return generated ?: Chord("C", "", null, null, listOf(0, 4, 7))
}

// Custom Selector Composable
@Composable
fun ChordSelector(
    label: String,
    selectedValue: String,
    options: List<String>,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true
) {
    var expanded by remember { mutableStateOf(false) }
    
    Box(modifier = modifier) {
        Column {
            Text(
                text = label,
                color = if (enabled) Slate500 else Slate600.copy(alpha = 0.4f),
                fontSize = 10.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 0.5.sp
            )
            Spacer(modifier = Modifier.height(4.dp))
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(44.dp)
                    .background(
                        color = if (enabled) Slate900 else Slate950.copy(alpha = 0.5f),
                        shape = RoundedCornerShape(12.dp)
                    )
                    .border(
                        width = 1.dp,
                        color = if (enabled) Slate800 else Slate900,
                        shape = RoundedCornerShape(12.dp)
                    )
                    .clickable(enabled = enabled) { expanded = true }
                    .padding(horizontal = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(
                    text = selectedValue,
                    color = if (enabled) Color.White else Slate600,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1
                )
                Icon(
                    imageVector = Icons.Default.ArrowDropDown,
                    contentDescription = "Dropdown",
                    tint = if (enabled) Slate500 else Slate600,
                    modifier = Modifier.size(18.dp)
                )
            }
        }
        
        DropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
            modifier = Modifier
                .background(Slate900)
                .border(1.dp, Slate800, RoundedCornerShape(12.dp))
        ) {
            options.forEach { option ->
                DropdownMenuItem(
                    text = {
                        Text(
                            text = option,
                            color = Color.White,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Medium
                        )
                    },
                    onClick = {
                        onValueChange(option)
                        expanded = false
                    }
                )
            }
        }
    }
}

// Square compact modifiers button
@Composable
fun ModifierButton(
    text: String,
    isActive: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true
) {
    val bg = when {
        !enabled -> Slate950.copy(alpha = 0.3f)
        isActive -> when {
            text == "7" || text == "#" || text == "m" -> Emerald500
            text == "/B" -> Blue500
            else -> Slate700
        }
        else -> Slate800.copy(alpha = 0.5f)
    }
    
    val borderCol = when {
        !enabled -> Slate950
        isActive -> when {
            text == "7" || text == "#" || text == "m" -> Emerald400
            text == "/B" -> Blue400
            else -> Slate600
        }
        else -> Slate800
    }
    
    val textCol = when {
        !enabled -> Slate600
        isActive -> when {
            text == "7" || text == "#" || text == "m" || text == "/B" -> Slate950
            else -> Color.White
        }
        else -> Slate500
    }
    
    Box(
        modifier = modifier
            .height(46.dp)
            .background(bg, RoundedCornerShape(12.dp))
            .border(1.dp, borderCol, RoundedCornerShape(12.dp))
            .clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center
    ) {
        Text(
            text = text,
            color = textCol,
            fontSize = if (text.length > 2) 11.sp else 16.sp,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center
        )
    }
}

// Helper to determine after which white key each black key semitone belongs
fun getBlackKeyPosition(semitone: Int): Int {
    return when (semitone) {
        1 -> 0
        3 -> 1
        6 -> 3
        8 -> 4
        10 -> 5
        13 -> 7
        15 -> 8
        18 -> 10
        20 -> 11
        22 -> 12
        else -> 0
    }
}

// Visual Piano Keyboard Composable
@Composable
fun PianoKeyboard(
    activeSemitones: Set<Int>,
    modifier: Modifier = Modifier
) {
    val whiteKeySemitones = listOf(0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19, 21, 23)
    val blackKeySemitones = listOf(1, 3, 6, 8, 10, 13, 15, 18, 20, 22)
    
    BoxWithConstraints(
        modifier = modifier
            .fillMaxWidth()
            .height(96.dp)
            .background(Slate950, RoundedCornerShape(8.dp))
            .border(1.dp, Slate700, RoundedCornerShape(8.dp))
            .padding(1.dp)
    ) {
        val totalWidth = maxWidth
        val totalHeight = maxHeight
        val whiteKeyWidth = totalWidth / 14
        
        // 1. Draw White Keys
        Row(modifier = Modifier.fillMaxSize()) {
            whiteKeySemitones.forEach { semitone ->
                val isActive = activeSemitones.contains(semitone)
                Box(
                    modifier = Modifier
                        .width(whiteKeyWidth)
                        .fillMaxHeight()
                        .padding(horizontal = 0.5.dp)
                        .background(
                            color = if (isActive) Color(0xFFE2E8F0) else Color.White,
                            shape = RoundedCornerShape(bottomStart = 4.dp, bottomEnd = 4.dp)
                        )
                        .border(
                            width = 0.5.dp,
                            color = Slate800,
                            shape = RoundedCornerShape(bottomStart = 4.dp, bottomEnd = 4.dp)
                        )
                ) {
                    if (isActive) {
                        // Glowing emerald/green dot for active note
                        Box(
                            modifier = Modifier
                                .size(8.dp)
                                .align(Alignment.BottomCenter)
                                .padding(bottom = 6.dp)
                                .background(Emerald500, CircleShape)
                        )
                    }
                }
            }
        }
        
        // 2. Draw Black Keys layered on top
        blackKeySemitones.forEach { semitone ->
            val isActive = activeSemitones.contains(semitone)
            val whiteIndex = getBlackKeyPosition(semitone)
            val blackKeyWidth = whiteKeyWidth * 0.65f
            val blackKeyHeight = totalHeight * 0.58f
            val leftOffset = whiteKeyWidth * (whiteIndex + 1) - (blackKeyWidth / 2)
            
            Box(
                modifier = Modifier
                    .offset(x = leftOffset)
                    .width(blackKeyWidth)
                    .height(blackKeyHeight)
                    .background(
                        color = if (isActive) Slate950 else Color(0xFF0F172A),
                        shape = RoundedCornerShape(bottomStart = 2.dp, bottomEnd = 2.dp)
                    )
                    .border(
                        width = 0.5.dp,
                        color = if (isActive) Emerald500 else Color(0xFF111827),
                        shape = RoundedCornerShape(bottomStart = 2.dp, bottomEnd = 2.dp)
                    )
            ) {
                if (isActive) {
                    // Green dot slightly higher up
                    Box(
                        modifier = Modifier
                            .size(6.dp)
                            .align(Alignment.BottomCenter)
                            .padding(bottom = 8.dp)
                            .background(Emerald500, CircleShape)
                    )
                }
            }
        }
    }
}

// Format the Chord to display
fun getFormattedChord(chord: Chord?, isLatin: Boolean): String {
    if (chord == null) return ""
    val rootName = if (isLatin) getNoteNameLatin(chord.root) else chord.root
    val suffix = chord.suffix
    val bassPart = if (chord.bass != null && chord.bass != chord.root) {
        "/" + (if (isLatin) getNoteNameLatin(chord.bass) else chord.bass)
    } else {
        ""
    }
    return "$rootName$suffix$bassPart"
}

// Main Composable UI of the app
@Composable
fun ChordPracticeApp(viewModel: ChordViewModel = viewModel()) {
    val bpm by viewModel.bpm.collectAsState()
    val isPlaying by viewModel.isPlaying.collectAsState()
    val beat by viewModel.beat.collectAsState()
    val measuresToChange by viewModel.measuresToChange.collectAsState()
    val rootTone by viewModel.rootTone.collectAsState()
    val scaleMode by viewModel.scaleMode.collectAsState()
    val isLatin by viewModel.isLatin.collectAsState()
    
    val isSharpsActive by viewModel.isSharpsActive.collectAsState()
    val isMinorsActive by viewModel.isMinorsActive.collectAsState()
    val isSeventhsActive by viewModel.isSeventhsActive.collectAsState()
    val isInversionsActive by viewModel.isInversionsActive.collectAsState()
    
    val currentChord by viewModel.currentChord.collectAsState()
    val nextChord by viewModel.nextChord.collectAsState()
    val measureCount by viewModel.measureCount.collectAsState()
    
    // Calculate active semitones for the visual keyboard
    val activeSemitones = remember(currentChord) {
        val set = mutableSetOf<Int>()
        currentChord?.let { chord ->
            // Left octave (root or bass)
            val leftNote = chord.bass ?: chord.root
            set.add(getSemitone(leftNote))
            
            // Right octave (chord notes mapped to 12..23)
            val rootOffset = getSemitone(chord.root)
            chord.noteSemitones.forEach { interval ->
                val semitone = 12 + (rootOffset + interval) % 12
                set.add(semitone)
            }
        }
        set
    }
    
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Slate950)
            .windowInsetsPadding(WindowInsets.safeDrawing)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.SpaceBetween
    ) {
        // 1. Header (Top)
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(bottom = 6.dp, top = 2.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    imageVector = Icons.Default.MusicNote,
                    contentDescription = null,
                    tint = Slate500,
                    modifier = Modifier.size(16.dp)
                )
                Spacer(modifier = Modifier.width(6.dp))
                Text(
                    text = "PRÁCTICA ACORDES",
                    color = Color(0xFF94A3B8), // Slate 400
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 1.sp
                )
            }
            
            // Glowing state indicator
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                Box(
                    modifier = Modifier
                        .size(8.dp)
                        .background(if (isPlaying) Emerald500 else Slate700, CircleShape)
                )
                Text(
                    text = if (isPlaying) "METRÓNOMO ACTIVO" else "DETENIDO",
                    color = if (isPlaying) Emerald400 else Slate500,
                    fontSize = 10.sp,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 0.5.sp
                )
            }
        }
        
        // 2. Central Area (Flex-1)
        Card(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .padding(vertical = 4.dp),
            colors = CardDefaults.cardColors(containerColor = Slate900),
            shape = RoundedCornerShape(32.dp),
            border = BorderStroke(1.dp, Slate800)
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(16.dp),
                verticalArrangement = Arrangement.SpaceBetween
            ) {
                // Top Info row
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    // Left: Measure Progress (e.g. 1/4)
                    Column {
                        Text(
                            text = "COMPÁS",
                            color = Slate500,
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Bold,
                            letterSpacing = 1.sp
                        )
                        Spacer(modifier = Modifier.height(2.dp))
                        Text(
                            text = "$measureCount/$measuresToChange",
                            color = Emerald400,
                            fontSize = 18.sp,
                            fontWeight = FontWeight.Bold,
                            fontFamily = FontFamily.Monospace
                        )
                    }
                    
                    // Center: Active Scale / Mode Title (Campo Tonal)
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(
                            text = "CAMPO TONAL",
                            color = Slate500,
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Bold,
                            letterSpacing = 1.sp
                        )
                        Spacer(modifier = Modifier.height(2.dp))
                        val scaleLabel = remember(rootTone, scaleMode, isLatin) {
                            if (rootTone == "Libre") {
                                "Modo Libre"
                            } else {
                                val r = if (isLatin) getNoteNameLatin(rootTone) else rootTone
                                "$r $scaleMode"
                            }
                        }
                        Text(
                            text = scaleLabel,
                            color = Color.White,
                            fontSize = 14.sp,
                            fontWeight = FontWeight.Bold
                        )
                    }
                    
                    // Right: Next Chord Box with Slate800 container and Slate700 border
                    Box(
                        modifier = Modifier
                            .background(Slate800, RoundedCornerShape(16.dp))
                            .border(1.dp, Slate700, RoundedCornerShape(16.dp))
                            .padding(horizontal = 12.dp, vertical = 6.dp)
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(
                                text = "SIGUIENTE",
                                color = Slate500,
                                fontSize = 9.sp,
                                fontWeight = FontWeight.Bold,
                                letterSpacing = 0.5.sp
                            )
                            Spacer(modifier = Modifier.height(2.dp))
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(
                                    text = getFormattedChord(nextChord, isLatin),
                                    color = Color(0xFFCBD5E1), // Slate 300
                                    fontSize = 13.sp,
                                    fontWeight = FontWeight.Bold,
                                    fontStyle = FontStyle.Italic
                                )
                                nextChord?.degree?.let { deg ->
                                    Spacer(modifier = Modifier.width(3.dp))
                                    Text(
                                        text = deg,
                                        color = Slate500,
                                        fontSize = 10.sp,
                                        fontWeight = FontWeight.Bold,
                                        fontStyle = FontStyle.Normal
                                    )
                                }
                            }
                        }
                    }
                }
                
                // Center Chord Display (massive font, text-[6rem] to text-[9rem] styled dynamically)
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f),
                    contentAlignment = Alignment.Center
                ) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center
                    ) {
                        // Roman Numeral Degree Badge
                        currentChord?.degree?.let { deg ->
                            Box(
                                modifier = Modifier
                                    .background(Emerald500.copy(alpha = 0.1f), RoundedCornerShape(100.dp))
                                    .border(1.dp, Emerald500.copy(alpha = 0.2f), RoundedCornerShape(100.dp))
                                    .padding(horizontal = 14.dp, vertical = 3.dp)
                            ) {
                                Text(
                                    text = deg,
                                    color = Emerald500,
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Bold,
                                    letterSpacing = 0.5.sp
                                )
                            }
                            Spacer(modifier = Modifier.height(8.dp))
                        }
                        
                        // Styled Chord Display using buildAnnotatedString
                        val current = currentChord
                        if (current != null) {
                            val annotatedChord = buildAnnotatedString {
                                val rootStr = if (isLatin) getNoteNameLatin(current.root) else current.root
                                append(rootStr)
                                
                                val suffixStr = current.suffix
                                if (suffixStr.isNotEmpty()) {
                                    // Use a smaller, italic emerald font for chord quality/suffix
                                    withStyle(style = SpanStyle(
                                        color = Emerald400,
                                        fontSize = 38.sp,
                                        fontWeight = FontWeight.Bold,
                                        fontStyle = FontStyle.Italic
                                    )) {
                                        append(suffixStr)
                                    }
                                }
                                
                                val bassStr = current.bass
                                if (bassStr != null && bassStr != current.root) {
                                    val bassName = if (isLatin) getNoteNameLatin(bassStr) else bassStr
                                    // Use a blue tint for the altered bass note
                                    withStyle(style = SpanStyle(
                                        color = Blue400,
                                        fontSize = 34.sp,
                                        fontWeight = FontWeight.Bold
                                    )) {
                                        append("/$bassName")
                                    }
                                }
                            }
                            
                            Text(
                                text = annotatedChord,
                                color = Color.White,
                                fontSize = 80.sp,
                                fontWeight = FontWeight.Black,
                                fontFamily = FontFamily.SansSerif,
                                textAlign = TextAlign.Center,
                                lineHeight = 80.sp,
                                maxLines = 1
                            )
                        }
                    }
                }
                
                // Visual 2-Octave Keyboard
                Column(
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(
                        text = "TECLADO VIRTUAL",
                        color = Slate500,
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = 1.sp,
                        modifier = Modifier.padding(bottom = 6.dp)
                    )
                    PianoKeyboard(activeSemitones = activeSemitones)
                }
                
                Spacer(modifier = Modifier.height(4.dp))
                
                // Metronome visualizer (4 clean dots)
                Row(
                    modifier = Modifier.fillMaxWidth().padding(bottom = 2.dp),
                    horizontalArrangement = Arrangement.Center,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    for (i in 1..4) {
                        val isCurrent = isPlaying && beat == i
                        val size = if (isCurrent && i == 1) 14.dp else if (isCurrent) 10.dp else 10.dp
                        val color = when {
                            isCurrent && i == 1 -> Emerald500
                            isCurrent -> Emerald500.copy(alpha = 0.8f)
                            else -> Slate800
                        }
                        
                        Box(
                            modifier = Modifier
                                .padding(horizontal = 8.dp)
                                .size(size)
                                .background(color, CircleShape)
                        )
                    }
                }
            }
        }
        
        // 3. Bottom Controls Panel (dense, fixed, no scrolling)
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 4.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            // Row 1: Selectors
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                // Select Tono: "Libre", "C", "C#"...
                val toneOptions = listOf("Libre", "C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B")
                val toneLabel = if (isLatin && rootTone != "Libre") getNoteNameLatin(rootTone) else rootTone
                ChordSelector(
                    label = "CAMPO TONAL",
                    selectedValue = toneLabel,
                    options = toneOptions,
                    onValueChange = { selected ->
                        if (selected == "Libre") {
                            viewModel.setRootTone("Libre")
                        } else {
                            viewModel.setRootTone(selected)
                        }
                    },
                    modifier = Modifier.weight(1.2f)
                )
                
                // Select Escala/Modo: "Mayor", "Menor" (only enabled if rootTone != "Libre")
                val isScaleEnabled = rootTone != "Libre"
                ChordSelector(
                    label = "MODO ESCALA",
                    selectedValue = scaleMode,
                    options = listOf("Mayor", "Menor"),
                    onValueChange = { viewModel.setScaleMode(it) },
                    modifier = Modifier.weight(1f),
                    enabled = isScaleEnabled
                )
                
                // Select Compases: "1", "2", "4"
                ChordSelector(
                    label = "CAMBIO COMPÁS",
                    selectedValue = "$measuresToChange ${if (measuresToChange == 1) "Compás" else "Compases"}",
                    options = listOf("1 Compás", "2 Compases", "4 Compases"),
                    onValueChange = { selected ->
                        val m = when (selected) {
                            "1 Compás" -> 1
                            "2 Compases" -> 2
                            "4 Compases" -> 4
                            else -> 1
                        }
                        viewModel.setMeasuresToChange(m)
                    },
                    modifier = Modifier.weight(1.2f)
                )
            }
            
            // Row 2: Modifiers Row
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                val isFree = rootTone == "Libre"
                
                // [ # ]
                ModifierButton(
                    text = "#",
                    isActive = isSharpsActive,
                    onClick = { viewModel.toggleSharps() },
                    modifier = Modifier.weight(1f),
                    enabled = isFree
                )
                
                // [ m ]
                ModifierButton(
                    text = "m",
                    isActive = isMinorsActive,
                    onClick = { viewModel.toggleMinors() },
                    modifier = Modifier.weight(1f),
                    enabled = isFree
                )
                
                // [ 7 ]
                ModifierButton(
                    text = "7",
                    isActive = isSeventhsActive,
                    onClick = { viewModel.toggleSevenths() },
                    modifier = Modifier.weight(1f)
                )
                
                // [ /B ]
                ModifierButton(
                    text = "/B",
                    isActive = isInversionsActive,
                    onClick = { viewModel.toggleInversions() },
                    modifier = Modifier.weight(1f)
                )
                
                // [ Lat/Ang (Do/C) ]
                ModifierButton(
                    text = if (isLatin) "Do/Re" else "C/D",
                    isActive = isLatin,
                    onClick = { viewModel.toggleLatin() },
                    modifier = Modifier.weight(1.2f)
                )
            }
            
            // Row 3: Play Button & BPM Slider/Buttons
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 2.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                // Play / Stop Button with tailwind Rose600/Emerald600 colors and rounded-2xl shape
                Button(
                    onClick = { viewModel.togglePlay() },
                    colors = ButtonDefaults.buttonColors(
                        containerColor = if (isPlaying) Rose600 else Emerald500,
                        contentColor = Color.White
                    ),
                    modifier = Modifier
                        .height(48.dp)
                        .weight(1.2f),
                    shape = RoundedCornerShape(16.dp)
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.Center
                    ) {
                        Icon(
                            imageVector = if (isPlaying) Icons.Default.Stop else Icons.Default.PlayArrow,
                            contentDescription = if (isPlaying) "Stop" else "Play",
                            modifier = Modifier.size(20.dp)
                        )
                        Spacer(modifier = Modifier.width(6.dp))
                        Text(
                            text = if (isPlaying) "STOP" else "START",
                            fontSize = 14.sp,
                            fontWeight = FontWeight.Bold
                        )
                    }
                }
                
                // BPM Controls Container in Slate900, Slate800 border, RoundedCornerShape(16.dp)
                Row(
                    modifier = Modifier
                        .height(48.dp)
                        .weight(1.5f)
                        .background(Slate900, RoundedCornerShape(16.dp))
                        .border(1.dp, Slate800, RoundedCornerShape(16.dp))
                        .padding(horizontal = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    // Minus Button
                    IconButton(
                        onClick = { viewModel.setBpm(bpm - 5) },
                        modifier = Modifier
                            .size(36.dp)
                            .background(Slate800, RoundedCornerShape(12.dp))
                    ) {
                        Icon(
                            imageVector = Icons.Default.Remove,
                            contentDescription = "Reduce BPM",
                            tint = Color.White,
                            modifier = Modifier.size(18.dp)
                        )
                    }
                    
                    // BPM Number
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        modifier = Modifier.weight(1f)
                    ) {
                        Text(
                            text = "BPM",
                            color = Slate500,
                            fontSize = 8.sp,
                            fontWeight = FontWeight.Bold,
                            lineHeight = 8.sp
                        )
                        Spacer(modifier = Modifier.height(1.dp))
                        Text(
                            text = "$bpm",
                            color = Color.White,
                            fontSize = 16.sp,
                            fontWeight = FontWeight.Black,
                            fontFamily = FontFamily.Monospace,
                            lineHeight = 16.sp
                        )
                    }
                    
                    // Plus Button
                    IconButton(
                        onClick = { viewModel.setBpm(bpm + 5) },
                        modifier = Modifier
                            .size(36.dp)
                            .background(Slate800, RoundedCornerShape(12.dp))
                    ) {
                        Icon(
                            imageVector = Icons.Default.Add,
                            contentDescription = "Increase BPM",
                            tint = Color.White,
                            modifier = Modifier.size(18.dp)
                        )
                    }
                }
            }
        }
    }
}

@Preview(showBackground = true)
@Composable
fun PreviewPracticeApp() {
    MaterialTheme {
        Surface(color = Slate950) {
            ChordPracticeApp()
        }
    }
}
