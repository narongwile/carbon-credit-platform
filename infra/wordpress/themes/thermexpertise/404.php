<?php
/**
 * 404 template.
 *
 * @package ThermExpertise
 */

get_header();
?>
<section class="section">
	<div class="container" style="text-align:center">
		<h1 class="section__title">404</h1>
		<p><?php esc_html_e( 'The page you are looking for could not be found.', 'thermexpertise' ); ?></p>
		<a class="btn btn--accent" href="<?php echo esc_url( home_url( '/' ) ); ?>"><?php esc_html_e( 'Back home', 'thermexpertise' ); ?></a>
	</div>
</section>
<?php
get_footer();
