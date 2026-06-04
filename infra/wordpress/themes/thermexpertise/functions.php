<?php
/**
 * ThermExpertise theme bootstrap.
 *
 * @package ThermExpertise
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit; // No direct access.
}

define( 'THEX_VERSION', '1.0.0' );

/**
 * Theme supports + menu registration.
 */
function thex_setup() {
	load_theme_textdomain( 'thermexpertise', get_template_directory() . '/languages' );

	add_theme_support( 'automatic-feed-links' );
	add_theme_support( 'title-tag' );
	add_theme_support( 'post-thumbnails' );
	add_theme_support( 'html5', array( 'search-form', 'gallery', 'caption', 'style', 'script', 'navigation-widgets' ) );
	add_theme_support( 'custom-logo', array(
		'height'      => 120,
		'width'       => 400,
		'flex-height' => true,
		'flex-width'  => true,
	) );
	add_theme_support( 'responsive-embeds' );
	add_theme_support( 'align-wide' );
	add_theme_support( 'editor-styles' );

	register_nav_menus( array(
		'primary' => __( 'Primary Menu', 'thermexpertise' ),
		'footer'  => __( 'Footer Menu', 'thermexpertise' ),
	) );
}
add_action( 'after_setup_theme', 'thex_setup' );

/**
 * Enqueue styles & scripts.
 */
function thex_assets() {
	wp_enqueue_style( 'thex-fonts', 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Sora:wght@600;700;800&display=swap', array(), null );
	wp_enqueue_style( 'thex-style', get_stylesheet_uri(), array(), THEX_VERSION );
	wp_enqueue_style( 'thex-main', get_template_directory_uri() . '/assets/css/main.css', array( 'thex-style' ), THEX_VERSION );

	wp_enqueue_script( 'thex-main', get_template_directory_uri() . '/assets/js/main.js', array(), THEX_VERSION, true );

	if ( is_singular() && comments_open() && get_option( 'thread_comments' ) ) {
		wp_enqueue_script( 'comment-reply' );
	}
}
add_action( 'wp_enqueue_scripts', 'thex_assets' );

/**
 * Widget areas.
 */
function thex_widgets() {
	register_sidebar( array(
		'name'          => __( 'Footer', 'thermexpertise' ),
		'id'            => 'footer-1',
		'description'   => __( 'Footer widget area.', 'thermexpertise' ),
		'before_widget' => '<div class="widget %2$s">',
		'after_widget'  => '</div>',
		'before_title'  => '<h4 class="widget-title">',
		'after_title'   => '</h4>',
	) );
}
add_action( 'widgets_init', 'thex_widgets' );

/**
 * Theme Customizer — company contact details so footer/header pull from one place.
 * TODO: populate defaults with the real values from the Wix site once crawled.
 */
function thex_customize_register( $wp_customize ) {
	$wp_customize->add_section( 'thex_contact', array(
		'title'    => __( 'ThermExpertise — Contact', 'thermexpertise' ),
		'priority' => 30,
	) );

	$fields = array(
		'thex_phone'    => array( __( 'Phone', 'thermexpertise' ), '' ),
		'thex_email'    => array( __( 'Email', 'thermexpertise' ), '' ),
		'thex_address'  => array( __( 'Address', 'thermexpertise' ), '' ),
		'thex_line'     => array( __( 'LINE / messaging URL', 'thermexpertise' ), '' ),
		'thex_facebook' => array( __( 'Facebook URL', 'thermexpertise' ), '' ),
	);

	foreach ( $fields as $id => $meta ) {
		$wp_customize->add_setting( $id, array( 'default' => $meta[1], 'sanitize_callback' => 'wp_kses_post' ) );
		$wp_customize->add_control( $id, array(
			'label'   => $meta[0],
			'section' => 'thex_contact',
			'type'    => 'text',
		) );
	}
}
add_action( 'customize_register', 'thex_customize_register' );

/**
 * Helper: echo a customizer contact value.
 */
function thex_contact( $key, $default = '' ) {
	return get_theme_mod( $key, $default );
}
